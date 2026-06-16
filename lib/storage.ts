import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { DocumentRecord } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const FILES_DIR = path.join(DATA_DIR, "files");
const DB_PATH = path.join(DATA_DIR, "documents.json");

// The document DB is a single JSON file rewritten on every mutation. A naive
// read-modify-write races when two requests commit at once: both read the
// pre-write state and the later write drops the earlier change. We serialize
// every mutation through one promise chain so each read-modify-write runs to
// completion before the next begins — the same primitive the contracts store
// uses. This keeps the JSON-on-disk model while making concurrent signing safe
// within this process.
let writeQueue: Promise<unknown> = Promise.resolve();

function withDbLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  // Keep the chain alive even if a mutation rejects, so one failure doesn't
  // wedge every later write.
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function ensureDirs() {
  await fs.mkdir(FILES_DIR, { recursive: true });
}

// This machine runs live OpenClaw bots that touch the data tree; EBUSY/EPERM
// from a foreign open handle (bot, antivirus, indexer) is a known transient on
// Windows. withDbLock serializes OUR writes; this retry handles foreign handles.
export async function withEbusyRetry<T>(op: () => Promise<T>): Promise<T> {
  const delays = [100, 300, 700];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await op();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EBUSY" && code !== "EPERM" && code !== "EACCES") throw err;
      lastErr = err;
      if (attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
  }
  throw lastErr;
}

async function readDb(): Promise<DocumentRecord[]> {
  await ensureDirs();
  try {
    const buf = await fs.readFile(DB_PATH, "utf8");
    return JSON.parse(buf) as DocumentRecord[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeDb(rows: DocumentRecord[]) {
  await ensureDirs();
  const tmp = DB_PATH + ".tmp";
  await withEbusyRetry(async () => {
    const fh = await fs.open(tmp, "w");
    try {
      await fh.writeFile(JSON.stringify(rows, null, 2), "utf8");
      await fh.sync(); // durable before the rename — RPO 0 for the metadata DB.
    } finally {
      await fh.close();
    }
    await fs.rename(tmp, DB_PATH);
  });
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  const rows = await readDb();
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDocument(id: string): Promise<DocumentRecord | null> {
  const rows = await readDb();
  return rows.find((r) => r.id === id) ?? null;
}

// Look a document up by a signer token (single signer). Returns null if no
// document carries that exact token.
export async function getDocumentByToken(token: string): Promise<DocumentRecord | null> {
  const rows = await readDb();
  return rows.find((r) => r.signer?.token === token) ?? null;
}

export function createDocument(
  partial: Omit<DocumentRecord, "id" | "createdAt" | "updatedAt" | "audit"> & {
    audit?: DocumentRecord["audit"];
  },
): Promise<DocumentRecord> {
  return withDbLock(async () => {
    const rows = await readDb();
    const now = new Date().toISOString();
    const rec: DocumentRecord = {
      id: nanoid(12),
      createdAt: now,
      updatedAt: now,
      audit: partial.audit ?? [],
      ...partial,
    };
    rows.push(rec);
    await writeDb(rows);
    return rec;
  });
}

export function updateDocument(
  id: string,
  patch: Partial<DocumentRecord>,
): Promise<DocumentRecord> {
  return withDbLock(async () => {
    const rows = await readDb();
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error(`document ${id} not found`);
    const merged: DocumentRecord = {
      ...rows[idx],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    rows[idx] = merged;
    await writeDb(rows);
    return merged;
  });
}

// Run a read-modify-write transaction against one document atomically. The
// transform receives the freshest persisted row and returns the patch to apply
// (and may perform side effects like promoting a temp file). Everything runs
// inside the DB lock, so a concurrent request cannot read stale state and
// clobber this write. This is the safe primitive for the sign flow; prefer it
// over getDocument()+updateDocument() across a request.
export function mutateDocument<T>(
  id: string,
  transform: (current: DocumentRecord) => Promise<{ patch: Partial<DocumentRecord>; result: T }>,
): Promise<T> {
  return withDbLock(async () => {
    const rows = await readDb();
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error(`document ${id} not found`);
    const { patch, result } = await transform(rows[idx]);
    rows[idx] = {
      ...rows[idx],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await writeDb(rows);
    return result;
  });
}

// --- file storage ---------------------------------------------------------

// Save bytes to a fresh, collision-proof name. temp + fsync + atomic rename so a
// crash mid-write never leaves a truncated file at a real name.
export async function saveFileBytes(name: string, bytes: Uint8Array): Promise<string> {
  await ensureDirs();
  const safe = name.replace(/[^\w.\-]/g, "_");
  const full = `${Date.now()}_${nanoid(6)}_${safe}`;
  const finalPath = path.join(FILES_DIR, full);
  const tmp = finalPath + ".tmp";
  await withEbusyRetry(async () => {
    const fh = await fs.open(tmp, "w");
    try {
      await fh.writeFile(bytes);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.rename(tmp, finalPath);
  });
  return full;
}

export async function readFileBytes(filename: string): Promise<Uint8Array> {
  const buf = await fs.readFile(path.join(FILES_DIR, filename));
  return new Uint8Array(buf);
}

export function filePath(filename: string): string {
  return path.join(FILES_DIR, filename);
}

// Make a signed file read-only. Idempotent and RE-ASSERTABLE: this is the LAST
// step of the sign flow and runs AFTER the DB commit, so its failure (e.g. a
// transient Windows EBUSY from the live bots) is cosmetic, not transactional —
// the document is already committed and anchored. Integrity comes from the HMAC
// anchor, NOT this OS bit; read-only is accident-prevention. On Windows
// fs.chmod only toggles the readonly attribute, which is exactly what we want.
export async function sealReadOnly(filename: string): Promise<void> {
  await withEbusyRetry(() => fs.chmod(filePath(filename), 0o444));
}

// Delete a stored file. Clears the readonly attribute first so the unlink
// succeeds on Windows (where a readonly file cannot be deleted directly, unlike
// Linux where unlink ignores the mode). Used by the crash reconciler to discard
// a half-written/garbage signed file before re-signing.
export async function discardFile(filename: string): Promise<void> {
  const p = filePath(filename);
  await withEbusyRetry(async () => {
    try {
      await fs.chmod(p, 0o666);
    } catch {
      // best-effort; unlink may still work
    }
    await fs.unlink(p);
    // Sweep the sidecar anchor too.
    await fs.rm(p + ".anchor.json", { force: true });
  });
}
