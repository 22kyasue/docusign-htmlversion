import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendAuditLog } from "./audit-log";
import { getDocument, readFileBytes, updateDocument } from "./storage";
import {
  RecipientRefusedError,
  resolveCompletionRecipients,
} from "./email-recipients";
import type { DocumentRecord } from "./types";

// Completion email: on a successful sign, send ONE email via the Resend HTTP API
// with the signed PDF attached, to BOTH the signer and an archive address.
// Release-It discipline, mirrored from lib/webhook.ts:
//   - explicit per-attempt timeout (AbortController), never an infinite wait
//   - bounded retries with exponential backoff + jitter
//   - 4xx (except 429) is non-retryable; 429 / 5xx / network IS retryable
//   - idempotent: re-reads the persisted completionEmailSent flag before sending,
//     and only sets it AFTER a confirmed 2xx — so a void-fire + a reconciler
//     re-fire never double-send, and a crash mid-send leaves it retryable
//   - MUST be called AFTER the signer's HTTP response is sent — it must never
//     block or fail the signer's request
//   - resolves, NEVER rejects, so `void deliverCompletionEmail(...)` is safe
//   - terminal failure is LOUD: persisted on the record + the audit log
//   - HARD recipient guardrails live in lib/email-recipients.ts: only signer +
//     archive, ever; a banned recipient refuses the WHOLE send, fail-closed.

const RESEND_URL = "https://api.resend.com/emails";
const FROM_ADDRESS = "Tobira Studio <kotaro@tobira.studio>";
const ATTEMPT_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000]; // between attempts 1→2 … 4→5

export type CompletionEmailInput = {
  documentId: string;
  name: string; // document name → subject + attachment filename
  signedFile?: string; // path passed to readFileBytes()
  signer: { name: string; email: string } | null;
};

// ONE builder so the sign route and the reconciler can't drift.
export function buildCompletionEmail(doc: DocumentRecord): CompletionEmailInput {
  return {
    documentId: doc.id,
    name: doc.name,
    signedFile: doc.signedFile,
    signer: doc.signer ? { name: doc.signer.name, email: doc.signer.email } : null,
  };
}

// Resolve the Resend API key: env RESEND_API_KEY first, else the credentials
// file (dev fallback only — on the prod box the service user cannot read it, so
// the env var is mandatory there). Resolved lazily, per-send, never at import.
async function resolveApiKey(): Promise<string | undefined> {
  const fromEnv = process.env.RESEND_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = path.join(os.homedir(), ".openclaw", "credentials", "resend-api-key.txt");
  try {
    const raw = await fs.readFile(file, "utf8");
    const trimmed = raw.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

// Strip control chars before interpolating the (operator/upstream-supplied) doc
// name into the subject — defensive, no legitimate doc name contains them.
function safeText(s: string): string {
  return String(s).replace(/\p{Cc}/gu, " ").trim();
}

function buildSubject(name: string): string {
  return `【署名完了】${safeText(name)}`;
}

function buildBody(signerName: string | undefined): string {
  const greeting = signerName ? `${safeText(signerName)} 様\n\n` : "";
  return (
    greeting +
    "お世話になっております。Tobira Studio でございます。\n\n" +
    "ご署名を受け付けました。署名済みの書類を添付いたします。\n\n" +
    "添付の書類には改ざん検知（SHA-256 ハッシュによる電子的な保護）が施されており、" +
    "署名後の内容が変更されていないことを確認できます。\n\n" +
    "ご不明な点がございましたら、お気軽にご連絡ください。\n" +
    "どうぞよろしくお願いいたします。\n"
  );
}

function attachmentFilename(name: string): string {
  const base = safeText(name).replace(/\.pdf$/i, "");
  return `${base || "document"}.signed.pdf`;
}

type SendResult =
  | { ok: true; status: number; resendId?: string }
  | { ok: false; status: number; retryable: boolean; error: string };

// One POST to Resend with its own timeout. Returns a classified result; never
// throws for an HTTP status (only network/timeout throws are caught by the
// caller's try). 429 is retryable (rate-limit / quota); other 4xx are not.
async function postOnce(
  apiKey: string,
  to: string[],
  subject: string,
  body: string,
  attachmentContentB64: string,
  filename: string,
): Promise<SendResult> {
  const payload = {
    from: FROM_ADDRESS,
    to, // bare string addresses only — NO cc, NO bcc, NO reply_to, NO name-objects
    subject,
    text: body,
    attachments: [{ filename, content: attachmentContentB64 }],
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (res.status >= 200 && res.status < 300) {
      let resendId: string | undefined;
      try {
        const j = (await res.json()) as { id?: string };
        resendId = j.id;
      } catch {
        // a 2xx with an unparseable body is still a success
      }
      return { ok: true, status: res.status, resendId };
    }
    // 429 = rate-limit / quota → retryable. 408 + 5xx → retryable. Other 4xx →
    // terminal (bad key, bad payload, bad from-address). Never classify by "4xx".
    const retryable = res.status === 429 || res.status === 408 || res.status >= 500;
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      // ignore
    }
    return { ok: false, status: res.status, retryable, error: `status ${res.status} ${detail}`.trim() };
  } finally {
    clearTimeout(timer);
  }
}

// Fire-and-forget delivery with bounded retry. Resolves (never rejects).
export async function deliverCompletionEmail(input: CompletionEmailInput): Promise<void> {
  try {
    await deliver(input);
  } catch (err) {
    // Last-resort guard: deliver() is written to never throw, but a void-fired
    // promise that rejects would crash the process. Record + swallow.
    await safeLog(input.documentId, "email_failed", err instanceof Error ? err.message : String(err));
  }
}

async function deliver(input: CompletionEmailInput): Promise<void> {
  // Idempotency guard: re-read the freshest row. This is fired both as a
  // void-after-response AND by the boot reconciler (separate process), so the
  // persisted flag — not memory — is the only thing preventing a double-send.
  const fresh = (await getDocument(input.documentId)) ?? null;
  if (fresh?.completionEmailSent === true) return;
  if (!fresh || fresh.status !== "signed" || !fresh.signedFile) {
    // Nothing to send for — don't burn an attempt or set any flag.
    return;
  }

  // Recipient resolution + HARD ban (fail-closed on either signer or archive).
  let to: string[];
  try {
    to = resolveCompletionRecipients(fresh.signer?.email, process.env.SIGN_ARCHIVE_EMAIL);
  } catch (err) {
    const reason =
      err instanceof RecipientRefusedError
        ? err.reason
        : err instanceof Error
          ? err.message
          : String(err);
    // Fail-closed AND loud. No email sent at all. Mark "not sent" with the reason
    // so it is visible — but do NOT set completionEmailSent (it never went).
    await safeRecord(input.documentId, { sent: false, attempts: 0, lastError: `refused: ${reason}` });
    await safeLog(input.documentId, "email_refused_banned", reason);
    return;
  }

  const apiKey = await resolveApiKey();
  if (!apiKey) {
    // Not configured (local dev / missing env). Record it; not an error.
    await safeRecord(input.documentId, {
      sent: false,
      attempts: 0,
      lastError: "RESEND_API_KEY unset and no credentials file — email skipped",
    });
    return;
  }

  // Read + base64-encode the signed PDF ONCE, before the retry loop — re-reading
  // per attempt is wasted I/O and risks reading a half-written file.
  let attachmentB64: string;
  try {
    const bytes = await readFileBytes(fresh.signedFile);
    attachmentB64 = Buffer.from(bytes).toString("base64");
  } catch (err) {
    await safeRecord(input.documentId, {
      sent: false,
      attempts: 0,
      lastError: `could not read signed file: ${err instanceof Error ? err.message : String(err)}`,
    });
    await safeLog(input.documentId, "email_failed", "signed file unreadable");
    return;
  }

  const subject = buildSubject(fresh.name);
  const body = buildBody(fresh.signer?.name);
  const filename = attachmentFilename(fresh.name);

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await postOnce(apiKey, to, subject, body, attachmentB64, filename);
      if (r.ok) {
        // Set the idempotency flag ONLY after a confirmed 2xx.
        await safeRecord(input.documentId, { sent: true, attempts: attempt });
        await safeLog(
          input.documentId,
          "email_sent",
          `status=${r.status} attempt=${attempt} recipients=${to.length}${r.resendId ? ` id=${r.resendId}` : ""}`,
        );
        return;
      }
      lastError = r.error;
      if (!r.retryable) break; // terminal 4xx (not 429) — retrying won't help
    } catch (err) {
      // network / DNS / timeout (AbortError) — retryable
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < MAX_ATTEMPTS) {
      const base = BACKOFF_MS[attempt - 1] ?? 8_000;
      const jitter = Math.floor(Math.random() * 400);
      await new Promise((r) => setTimeout(r, base + jitter));
    }
  }

  // Exhausted / terminal — LOUD failure. The reconciler re-fires records with
  // completionEmailSent !== true on next start.
  await safeRecord(input.documentId, { sent: false, attempts: MAX_ATTEMPTS, lastError });
  await safeLog(input.documentId, "email_failed", lastError);
}

async function safeRecord(
  documentId: string,
  s: { sent: boolean; attempts: number; lastError?: string },
): Promise<void> {
  try {
    await updateDocument(documentId, {
      completionEmailSent: s.sent,
      completionEmailAttempts: s.attempts,
      completionEmailLastError: s.lastError,
    });
  } catch {
    // The doc may be gone; never let bookkeeping throw into a void context.
  }
}

async function safeLog(documentId: string, event: string, detail: string): Promise<void> {
  try {
    await appendAuditLog({ at: new Date().toISOString(), event, documentId, detail });
  } catch {
    // best-effort
  }
}
