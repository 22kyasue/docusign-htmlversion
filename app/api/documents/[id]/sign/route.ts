import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  mutateDocument,
  readFileBytes,
  saveFileBytes,
  sealReadOnly,
  discardFile,
  filePath,
} from "@/lib/storage";
import { sha256, hmacEquals } from "@/lib/crypto";
import { computeAnchor, writeAnchorFile } from "@/lib/anchor";
import { appendAuditLog } from "@/lib/audit-log";
import { deliverCompletion, buildCompletionPayload } from "@/lib/webhook";
import { deliverCompletionEmail, buildCompletionEmail } from "@/lib/email";
import { isValidPng } from "@/lib/png-validate";
import { isTokenExpired } from "@/lib/tokens";
import { stampSignature, appendAuditPage } from "@/lib/pdf";
import type { AuditEntry, DocumentRecord, DocumentSigner } from "@/lib/types";

export const runtime = "nodejs";

// ~1.4MB of base64 ≈ 1MB of PNG. A drawn signature is a few KB; this cap stops a
// token holder from buffering a huge payload that blocks the global DB lock.
const MAX_SIGNATURE_DATA_URL_LEN = 1_400_000;

// The signer never sends field coordinates — the field is pre-placed on the
// document at creation and read server-side. We only accept the token + the
// drawn signature image.
const BodySchema = z.object({
  token: z.string().min(8),
  signaturePngDataUrl: z
    .string()
    .startsWith("data:image/png;base64,")
    .max(MAX_SIGNATURE_DATA_URL_LEN),
});

type SignOutcome =
  | { ok: true; document: DocumentRecord; sealedFile: string }
  | { ok: false; status: number; error: string; signedAt?: string };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { token, signaturePngDataUrl } = parsed.data;

  // Validate the signature image up front. A legal endpoint must not trust the
  // client's "draw something" check — reject anything that isn't a non-empty PNG
  // so a blank/forged image can never seal the document.
  const pngBytes = Uint8Array.from(
    Buffer.from(signaturePngDataUrl.split(",")[1] ?? "", "base64"),
  );
  if (!isValidPng(pngBytes)) {
    return NextResponse.json(
      { error: "signature must be a valid, non-empty PNG image" },
      { status: 400 },
    );
  }

  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const ua = req.headers.get("user-agent") ?? undefined;

  // --- heavy, side-effect-free work BEFORE the lock -----------------------
  // Loading + stamping + audit-paging a PDF is CPU-heavy; doing it inside the
  // DB lock would serialize all signing on PDF render time. We do it here (no
  // durable mutation yet) and only take the lock for the re-check + atomic
  // promote + commit. Anything that fails here throws before any state change.
  // Note: we cannot precompute the signed file yet because the audit page must
  // include the freshest audit[] read inside the lock — so the stamp+seal
  // happens inside the transform. The DB-lock critical section therefore holds
  // the PDF work; given one-signer-at-a-time real usage this is acceptable, and
  // it keeps "never seal without the freshest state" correct. (Decision logged.)

  let outcome: SignOutcome;
  try {
    outcome = await mutateDocument<SignOutcome>(id, async (doc) => {
      const signer = doc.signer;
      if (!signer) {
        return { patch: {}, result: { ok: false, status: 401, error: "document has no signer" } };
      }
      // Terminal guard, checked against the freshest row inside the lock: a
      // signed document is canonical and must never be re-stamped or re-sealed.
      if (doc.status === "signed" || signer.signedAt) {
        return {
          patch: {},
          result: { ok: false, status: 409, error: "already signed", signedAt: signer.signedAt },
        };
      }
      // Constant-time compare — defence in depth (the token is 192-bit and
      // single-use, so timing leakage isn't practically exploitable, but the
      // helper is already here).
      if (!hmacEquals(token, signer.token)) {
        return { patch: {}, result: { ok: false, status: 401, error: "invalid signing token" } };
      }
      if (isTokenExpired(signer.tokenExpiresAt)) {
        return { patch: {}, result: { ok: false, status: 401, error: "token expired" } };
      }

      const now = new Date().toISOString();

      // Track the files we write so we can discard them if a LATER step in this
      // transform throws — otherwise a thrown anchor/stamp would roll back the DB
      // but leave a fully-stamped copy of the legal contract orphaned on disk.
      let sigFile: string | undefined;
      let signedFile: string | undefined;
      let finalHash: string;
      let anchorHmac: string | undefined;
      try {
        // Persist the raw signature PNG (internal; never served standalone).
        sigFile = await saveFileBytes(`sig_${doc.id}.png`, pngBytes);

        // Stamp at the SERVER-stored field coordinates — never client-supplied.
        const original = await readFileBytes(doc.originalFile);
        const stamped = await stampSignature({
          pdfBytes: original,
          signaturePng: pngBytes,
          fields: doc.fields,
        });
        const signedHashPreAudit = sha256(stamped);

        const signedEntry: AuditEntry = {
          at: now,
          action: "signed",
          actor: signer.name,
          ip,
          userAgent: ua,
          originalSha256: doc.originalSha256,
          signedSha256: signedHashPreAudit,
        };

        // Append the audit page; the FINAL hash is of the bytes-with-audit-page
        // (what lands on disk and what the anchor seals). The page prints the
        // pre-audit hash, labelled, so the two are never silently conflated.
        const withAudit = await appendAuditPage({
          pdfBytes: stamped,
          documentId: doc.id,
          documentName: doc.name,
          originalSha256: doc.originalSha256,
          signedSha256: signedHashPreAudit,
          entries: [...doc.audit, signedEntry],
        });
        finalHash = sha256(withAudit);

        // Atomic promote: saveFileBytes does temp + fsync + rename.
        signedFile = await saveFileBytes(`signed_${doc.name}`, withAudit);

        // Anchor (the real tamper-evidence) is written + fsync'd BEFORE the DB
        // commit. If this throws, the whole transform throws → DB rolls back →
        // no signed status, retryable. The OS read-only seal is NOT here — it
        // runs after commit, because a failed chmod must not leave a
        // sealed-but-uncommitted file the retry can't overwrite.
        const anchor = computeAnchor(withAudit);
        await writeAnchorFile(filePath(signedFile), anchor);
        anchorHmac = anchor.hmac;
      } catch (err) {
        // Roll back our orphaned files before the DB rolls back, so no stamped
        // copy of the contract is left behind for a failed sign.
        if (signedFile) await discardFile(signedFile).catch(() => {});
        if (sigFile) await discardFile(sigFile).catch(() => {});
        throw err;
      }

      const updatedSigner: DocumentSigner = {
        ...signer,
        signedAt: now,
        signatureImageFile: sigFile,
        ip,
        userAgent: ua,
      };

      const committedEntry: AuditEntry = {
        at: now,
        action: "signed",
        actor: signer.name,
        ip,
        userAgent: ua,
        originalSha256: doc.originalSha256,
        signedSha256: finalHash,
      };
      const patch: Partial<DocumentRecord> = {
        status: "signed",
        signedFile,
        signedSha256: finalHash,
        signedHmac: anchorHmac,
        signer: updatedSigner,
        webhookDelivered: false,
        webhookAttempts: 0,
        audit: [...doc.audit, committedEntry],
      };
      const merged: DocumentRecord = { ...doc, ...patch };
      return { patch, result: { ok: true, document: merged, sealedFile: signedFile } };
    });
  } catch (err: unknown) {
    if (err instanceof Error && /^document .* not found$/.test(err.message)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw err;
  }

  if (!outcome.ok) {
    const payload = outcome.signedAt
      ? { error: outcome.error, signedAt: outcome.signedAt }
      : { error: outcome.error };
    return NextResponse.json(payload, { status: outcome.status });
  }

  // --- post-commit, after the document is durably `signed` ----------------
  // 1) Append the append-only audit-log line (independent of the JSON DB).
  await appendAuditLog({
    at: outcome.document.signer?.signedAt ?? new Date().toISOString(),
    event: "signed",
    documentId: outcome.document.id,
    signedSha256: outcome.document.signedSha256,
    signer: outcome.document.signer?.email,
  }).catch(() => {});

  // 2) Seal the signed file read-only. LAST step: failure here is cosmetic (the
  //    anchor is the real guarantee), so we log it and let a reconciler retry —
  //    we never fail the signer's request over a transient Windows EBUSY.
  try {
    await sealReadOnly(outcome.sealedFile);
  } catch (err) {
    await appendAuditLog({
      at: new Date().toISOString(),
      event: "seal_failed",
      documentId: outcome.document.id,
      detail: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
  }

  // 3) Build the safe (token-stripped) response.
  const safe: DocumentRecord = {
    ...outcome.document,
    signer: outcome.document.signer
      ? { ...outcome.document.signer, token: "" }
      : undefined,
  };

  const response = NextResponse.json({ document: safe, completed: true });

  // 4) Fire the completion webhook AFTER building the response. On a long-lived
  //    Node process (Hetzner `next start`) this detached promise runs to
  //    completion; it has its own timeout + bounded retry and records its own
  //    outcome, so it can never block or fail the signer. Loud on failure.
  void deliverCompletion(buildCompletionPayload(outcome.document));

  // 5) Fire the completion EMAIL — the signed PDF to BOTH the signer and the
  //    archive address — the same way: after the response, fail-soft, idempotent
  //    (completionEmailSent flag), loud on failure. It can never block or fail
  //    the signer's request, and a banned recipient refuses the whole send.
  void deliverCompletionEmail(buildCompletionEmail(outcome.document));

  return response;
}
