import { listDocuments, getDocument, sealReadOnly, filePath } from "./storage";
import { verifyFile } from "./anchor";
import { appendAuditLog } from "./audit-log";
import { deliverCompletion, buildCompletionPayload } from "./webhook";
import type { DocumentRecord } from "./types";

// Crash recovery + dropped-webhook re-fire. Runs once on server start (via
// instrumentation.ts register()) and is safe to run repeatedly — every action is
// idempotent. Two jobs:
//
//   1. Re-fire any signed document whose completion webhook never delivered
//      (webhookDelivered !== true). The cockpit is idempotent on eventId, so a
//      re-fire of an already-processed completion is a no-op there. This closes
//      the "process died between commit and webhook" gap, and the "cockpit was
//      down during the original 5 retries" gap.
//
//   2. Re-assert read-only on any signed file whose anchor verifies but whose OS
//      seal didn't stick (a chmod that lost to a transient EBUSY post-commit).
//
// NOTE on the sealed-file-but-draft-DB crash gap: with the current sign flow the
// signed file + anchor are written INSIDE the DB transaction (same lock, before
// the JSON commit) using temp+rename, so a crash before commit leaves only
// orphaned files in data/files that the next sign overwrites under a fresh name
// — it never produces a committed-draft-pointing-at-a-sealed-file state. The
// terminal "already signed" guard (checked inside the lock) prevents any
// double-sign. So this reconciler does not need to forward-complete; it only
// needs the two idempotent repairs above. If the storage model ever promotes
// files OUTSIDE the lock, revisit this.

export async function runReconciler(): Promise<{ refired: number; resealed: number }> {
  let refired = 0;
  let resealed = 0;

  const docs = await listDocuments();
  for (const doc of docs) {
    if (doc.status !== "signed" || !doc.signedFile) continue;

    // (2) Re-assert read-only if the file verifies but may be unsealed.
    try {
      const verdict = await verifyFile(filePath(doc.signedFile));
      if (verdict.ok) {
        // File hash still matches → safe to re-assert read-only. If the anchor
        // is only hash-secured (no HMAC — sealed without SERVER_SECRET), note it
        // so integrity drift is visible rather than silently treated as fully
        // sealed.
        if (verdict.secured === false) {
          await appendAuditLog({
            at: new Date().toISOString(),
            event: "reconcile_unsecured_anchor",
            documentId: doc.id,
            detail: verdict.reason,
          }).catch(() => {});
        }
        await sealReadOnly(doc.signedFile);
        resealed++;
      } else {
        await appendAuditLog({
          at: new Date().toISOString(),
          event: "reconcile_tamper_suspected",
          documentId: doc.id,
          detail: verdict.reason,
        }).catch(() => {});
      }
    } catch {
      // best-effort; never let recovery throw
    }

    // (1) Re-fire a dropped completion webhook.
    if (doc.webhookDelivered !== true) {
      await refireWebhook(doc);
      refired++;
    }
  }
  return { refired, resealed };
}

async function refireWebhook(doc: DocumentRecord): Promise<void> {
  // Re-read the freshest row (NO lock, NO write — getDocument never mutates, so
  // we don't perturb updatedAt or the list sort order of a sealed legal record).
  // Re-check delivery state against fresh data before firing; deliverCompletion
  // records its own outcome on the record + audit log.
  try {
    const fresh = (await getDocument(doc.id)) ?? doc;
    if (fresh.status !== "signed" || fresh.webhookDelivered === true) return;
    await deliverCompletion(buildCompletionPayload(fresh));
  } catch {
    // best-effort
  }
}
