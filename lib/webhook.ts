import { createHmac } from "node:crypto";
import { appendAuditLog } from "./audit-log";
import { updateDocument } from "./storage";
import type { DocumentRecord } from "./types";

// Completion webhook: SovereignSign → cockpit. Fired when a document is fully
// signed. Release-It discipline throughout:
//   - explicit per-attempt timeout, never an infinite wait
//   - bounded retries with exponential backoff + jitter
//   - never retries a 4xx (non-retryable: the cockpit rejected the payload)
//   - idempotent by eventId so a retry / reconciler re-fire is safe
//   - MUST be called AFTER the signer's HTTP response is sent — it must never
//     block or fail the signer's request
//   - terminal failure is LOUD: persisted on the record + written to the audit
//     log so a dropped completion is never an invisible outage.

const ATTEMPT_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000]; // between attempts 1→2 … 4→5

export type CompletionPayload = {
  eventId: string; // `${documentId}:${signedSha256}` — stable, makes retries idempotent
  documentId: string;
  name: string;
  signedSha256: string;
  signedAt: string;
  signer: { name: string; email: string } | null;
  externalRef?: { system: string; leadId?: string; note?: string };
};

// Build the completion payload from a document. ONE place so the sign route and
// the reconciler can't drift — a divergent eventId would silently break the
// cockpit's idempotency dedup.
export function buildCompletionPayload(doc: DocumentRecord): CompletionPayload {
  return {
    eventId: `${doc.id}:${doc.signedSha256 ?? ""}`,
    documentId: doc.id,
    name: doc.name,
    signedSha256: doc.signedSha256 ?? "",
    signedAt: doc.signer?.signedAt ?? doc.updatedAt,
    signer: doc.signer ? { name: doc.signer.name, email: doc.signer.email } : null,
    externalRef: doc.externalRef,
  };
}

function sign(body: string, secret: string): { ts: string; sig: string } {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return { ts, sig };
}

async function postOnce(url: string, body: string, secret: string, eventId: string): Promise<number> {
  const { ts, sig } = sign(body, secret);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-docusign-timestamp": ts,
        "x-docusign-signature": sig,
        "x-idempotency-key": eventId,
      },
      body,
      signal: ctrl.signal,
    });
    return res.status;
  } finally {
    clearTimeout(timer);
  }
}

// Fire-and-forget delivery with bounded retry. Resolves (never rejects) so the
// caller can `void deliverCompletion(...)` after responding without an unhandled
// rejection. All outcomes are recorded on the document + audit log.
export async function deliverCompletion(payload: CompletionPayload): Promise<void> {
  const url = process.env.COMPLETION_WEBHOOK_URL;
  const secret = process.env.DOCUSIGN_API_SECRET;
  if (!url || !secret) {
    // No webhook configured (local dev). Record it; not an error.
    await safeRecord(payload.documentId, {
      delivered: false,
      attempts: 0,
      lastError: "COMPLETION_WEBHOOK_URL / DOCUSIGN_API_SECRET unset — webhook skipped",
    });
    return;
  }

  const body = JSON.stringify(payload);
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const status = await postOnce(url, body, secret, payload.eventId);
      if (status >= 200 && status < 300) {
        await safeRecord(payload.documentId, { delivered: true, attempts: attempt });
        await safeLog(payload, "webhook_delivered", `status=${status} attempt=${attempt}`);
        return;
      }
      // 4xx = non-retryable (the cockpit rejected the payload/sig). Stop now.
      if (status >= 400 && status < 500) {
        lastError = `non-retryable status ${status}`;
        break;
      }
      lastError = `status ${status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < MAX_ATTEMPTS) {
      const base = BACKOFF_MS[attempt - 1] ?? 8_000;
      const jitter = Math.floor(Math.random() * 400);
      await new Promise((r) => setTimeout(r, base + jitter));
    }
  }

  // Exhausted — LOUD failure. The reconciler re-fires records with
  // webhookDelivered === false on next start.
  await safeRecord(payload.documentId, {
    delivered: false,
    attempts: MAX_ATTEMPTS,
    lastError,
  });
  await safeLog(payload, "webhook_failed", lastError);
}

async function safeRecord(
  documentId: string,
  s: { delivered: boolean; attempts: number; lastError?: string },
): Promise<void> {
  try {
    await updateDocument(documentId, {
      webhookDelivered: s.delivered,
      webhookAttempts: s.attempts,
      webhookLastError: s.lastError,
    });
  } catch {
    // The doc may be gone; don't let bookkeeping throw into a void context.
  }
}

async function safeLog(payload: CompletionPayload, event: string, detail: string): Promise<void> {
  try {
    await appendAuditLog({
      at: new Date().toISOString(),
      event,
      documentId: payload.documentId,
      eventId: payload.eventId,
      detail,
    });
  } catch {
    // best-effort
  }
}
