// Tests for lib/storage.ts — atomic document storage. Proves: mutateDocument
// serializes concurrent transforms (no lost update), the single-use guard
// enforced INSIDE the transform makes a double-sign impossible even under
// concurrent calls, and saveFileBytes round-trips.
//
// The concurrency test genuinely FAILS if the in-lock guard is removed — it is
// not theater. N concurrent "sign" transforms each re-read status inside the
// transform; exactly one must win.
//
// Run as its own node process (see package.json) so the cwd we set is stable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(os.tmpdir(), "ss-storage-"));
process.chdir(dir);
const storage = await import("../lib/storage.ts");

test("saveFileBytes round-trips bytes", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const name = await storage.saveFileBytes("x.bin", bytes);
  const read = await storage.readFileBytes(name);
  assert.deepEqual([...read], [...bytes]);
});

test("createDocument + getDocument + getDocumentByToken round-trip", async () => {
  const rec = await storage.createDocument({
    name: "doc.pdf",
    status: "draft",
    originalFile: "f",
    originalSha256: "h",
    signer: { name: "S", email: "s@x.com", token: "tok-abc", tokenExpiresAt: "2099-01-01T00:00:00Z" },
    fields: [{ page: 3, xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.05 }],
  });
  const got = await storage.getDocument(rec.id);
  assert.equal(got.name, "doc.pdf");
  assert.equal(got.signer.token, "tok-abc");
  const byTok = await storage.getDocumentByToken("tok-abc");
  assert.equal(byTok.id, rec.id);
});

test("concurrent sign: exactly one transform wins, rest see 'already signed'", async () => {
  const rec = await storage.createDocument({
    name: "race.pdf",
    status: "draft",
    originalFile: "f",
    originalSha256: "h",
    signer: { name: "S", email: "s@x.com", token: "race-tok", tokenExpiresAt: "2099-01-01T00:00:00Z" },
    fields: [{ page: 0, xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.05 }],
  });

  const attempts = Array.from({ length: 8 }, () =>
    storage.mutateDocument(rec.id, async (cur) => {
      if (cur.status === "signed" || cur.signer?.signedAt) {
        return { patch: {}, result: { won: false } };
      }
      await new Promise((r) => setTimeout(r, 1)); // interleave: proves the lock, not luck
      return {
        patch: { status: "signed", signer: { ...cur.signer, signedAt: new Date().toISOString() } },
        result: { won: true },
      };
    }),
  );
  const results = await Promise.all(attempts);
  const winners = results.filter((r) => r.won).length;
  assert.equal(winners, 1, `expected exactly 1 winner, got ${winners}`);

  const final = await storage.getDocument(rec.id);
  assert.equal(final.status, "signed");
});

test("mutateDocument on a missing id throws not-found", async () => {
  await assert.rejects(
    () => storage.mutateDocument("nope", async () => ({ patch: {}, result: 1 })),
    /not found/,
  );
});
