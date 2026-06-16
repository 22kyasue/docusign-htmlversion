import { promises as fs } from "node:fs";
import path from "node:path";

// Append-only event log: one JSON object per line in data/audit.log, terminated
// by "\n". This is an INDEPENDENT record of every signing event, separate from
// the per-document audit[] array inside documents.json.
//
// WHY (vs the in-record array): documents.json is REWRITTEN in full on every
// mutation, so a bug in the write path can silently drop or reorder history.
// This file is only ever APPENDED to by our code, and it survives corruption of
// the DB file.
//
// HONEST CLAIM: append-only BY CONVENTION and by our process's write path. It is
// tamper-EVIDENT, not tamper-PROOF — it sits on the same mutable disk, so anyone
// with write access (root, a compromised process) can still truncate or rewrite
// it. Real resistance to a disk attacker requires shipping these lines off-box,
// append-only. Do not call this "tamper-proof".

const DATA_DIR = path.join(process.cwd(), "data");
const LOG_PATH = path.join(DATA_DIR, "audit.log");

export type AuditLogLine = {
  at: string;
  event: string;
  documentId: string;
  [k: string]: unknown;
};

// Append one event. fsync'd so a crash right after a signing event does not lose
// the log line (RPO 0 for the audit trail). O_APPEND makes our single-line write
// atomic against other appenders; we still serialize callers through the DB lock
// in storage.ts so ordering is deterministic.
export async function appendAuditLog(line: AuditLogLine): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const fh = await fs.open(LOG_PATH, "a");
  try {
    await fh.writeFile(JSON.stringify(line) + "\n", "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
}

// Read the log, tolerating a trailing partial line from a torn write on crash.
// Never assume the whole file parses — skip any line that doesn't.
export async function readAuditLog(): Promise<AuditLogLine[]> {
  let raw: string;
  try {
    raw = await fs.readFile(LOG_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: AuditLogLine[] = [];
  for (const lineStr of raw.split("\n")) {
    if (!lineStr.trim()) continue;
    try {
      out.push(JSON.parse(lineStr) as AuditLogLine);
    } catch {
      // Trailing partial line from a crash — skip it, keep the rest.
    }
  }
  return out;
}
