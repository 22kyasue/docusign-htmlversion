// Tests for lib/anchor.ts — the HMAC tamper-evidence anchor on signed files.
// Pure node:test. Proves: a clean file verifies; a modified file is detected; a
// re-hashed file without the secret cannot forge a passing anchor; a missing
// secret degrades honestly (not a false "secured").

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.SERVER_SECRET = "test-server-secret-0123456789";
const { computeAnchor, writeAnchorFile, verifyFile } = await import("../lib/anchor.ts");

async function tmpFile(bytes) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-anchor-"));
  const p = path.join(dir, "signed.pdf");
  await fs.writeFile(p, Buffer.from(bytes));
  return p;
}

test("clean sealed file verifies as secured", async () => {
  const p = await tmpFile("the canonical signed bytes");
  const bytes = new Uint8Array(await fs.readFile(p));
  await writeAnchorFile(p, computeAnchor(bytes));
  const v = await verifyFile(p);
  assert.equal(v.ok, true);
  assert.equal(v.secured, true);
});

test("modified file is detected (sha256 mismatch)", async () => {
  const p = await tmpFile("original bytes");
  const bytes = new Uint8Array(await fs.readFile(p));
  await writeAnchorFile(p, computeAnchor(bytes));
  await fs.writeFile(p, Buffer.from("tampered bytes")); // edit the file, leave anchor
  const v = await verifyFile(p);
  assert.equal(v.ok, false);
});

test("attacker without secret cannot forge a passing anchor by re-hashing", async () => {
  const p = await tmpFile("original");
  const bytes = new Uint8Array(await fs.readFile(p));
  await writeAnchorFile(p, computeAnchor(bytes));
  // Attacker edits the file AND re-hashes it in the sidecar (sha256 only), but
  // does not hold SERVER_SECRET so cannot regenerate the HMAC.
  const forged = "forged content";
  await fs.writeFile(p, Buffer.from(forged));
  const { createHash } = await import("node:crypto");
  const newHash = createHash("sha256").update(forged).digest("hex");
  await fs.writeFile(
    p + ".anchor.json",
    JSON.stringify({ algo: "sha256+hmac-sha256", sha256: newHash, hmac: "deadbeef", sealedAt: "x" }),
  );
  const v = await verifyFile(p);
  assert.equal(v.ok, false); // HMAC mismatch — forgery detected
});

test("missing anchor sidecar is reported, not silently passed", async () => {
  const p = await tmpFile("no anchor here");
  const v = await verifyFile(p);
  assert.equal(v.ok, false);
});
