// Tests for lib/audit-log.ts — the append-only event log. Proves: appends
// accumulate, a torn trailing line is tolerated on read, and entries round-trip.
//
// Run as its own node process (see package.json) so the process-wide cwd we set
// here is stable for the whole file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(os.tmpdir(), "ss-auditlog-"));
process.chdir(dir); // audit-log writes to process.cwd()/data — isolate to temp.
const { appendAuditLog, readAuditLog } = await import("../lib/audit-log.ts");
const LOG = path.join(dir, "data", "audit.log");

// node:test runs a file's tests concurrently; these share the process-wide cwd,
// so they must run in order and never chdir away mid-flight. Run them serially.
test("reading a non-existent log returns empty, not throw", async () => {
  const lines = await readAuditLog(); // nothing appended yet in this fresh temp dir
  assert.deepEqual(lines, []);
});

test("appends accumulate and round-trip", async () => {
  await appendAuditLog({ at: "2026-01-01T00:00:00Z", event: "signed", documentId: "a" });
  await appendAuditLog({ at: "2026-01-01T00:00:01Z", event: "webhook_delivered", documentId: "a" });
  const lines = await readAuditLog();
  assert.equal(lines.length, 2);
  assert.equal(lines[0].event, "signed");
  assert.equal(lines[1].event, "webhook_delivered");
  assert.equal(lines[1].documentId, "a");
});

test("a torn trailing line from a crash is skipped, prior lines survive", async () => {
  // Simulate a crash mid-append: a partial JSON fragment with no closing brace.
  await fs.appendFile(LOG, '{"at":"x","event":"partial","documentId":"b"');
  const lines = await readAuditLog();
  assert.equal(lines.length, 2); // the 2 good lines survive
  assert.ok(lines.every((l) => l.event !== "partial"));
});
