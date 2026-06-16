import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Contract, ContractAuditEntry } from "./contract-types";
import { readFileBytes, saveFileBytes } from "./storage";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "contracts.json");

// The contract DB is a single JSON file rewritten on every mutation. A naive
// read-modify-write races when two signers commit at once: both read the
// pre-signature state and the later write drops the earlier signature. We
// serialize every mutation through one promise chain so each read-modify-write
// runs to completion before the next begins. This keeps the JSON-on-disk model
// (no external DB) while making concurrent signing safe within this process.
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

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readDb(): Promise<Contract[]> {
  await ensureDir();
  try {
    const buf = await fs.readFile(DB_PATH, "utf8");
    return JSON.parse(buf) as Contract[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeDb(rows: Contract[]) {
  await ensureDir();
  const tmp = DB_PATH + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(rows, null, 2), "utf8");
  await fs.rename(tmp, DB_PATH);
}

export async function listContracts(): Promise<Contract[]> {
  const rows = await readDb();
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getContract(id: string): Promise<Contract | null> {
  const rows = await readDb();
  return rows.find((r) => r.id === id) ?? null;
}

export async function getContractByToken(
  token: string,
): Promise<{ contract: Contract; signerId: string } | null> {
  const rows = await readDb();
  for (const c of rows) {
    const signer = c.signers.find((s) => s.token === token);
    if (signer) return { contract: c, signerId: signer.id };
  }
  return null;
}

type CreateInput = Omit<Contract, "id" | "createdAt" | "updatedAt" | "audit"> & {
  audit?: ContractAuditEntry[];
};

export function createContract(input: CreateInput): Promise<Contract> {
  return withDbLock(async () => {
    const rows = await readDb();
    const now = new Date().toISOString();
    const rec: Contract = {
      id: nanoid(14),
      createdAt: now,
      updatedAt: now,
      audit: input.audit ?? [],
      ...input,
    };
    rows.push(rec);
    await writeDb(rows);
    return rec;
  });
}

export function updateContract(
  id: string,
  patch: Partial<Contract>,
): Promise<Contract> {
  return withDbLock(async () => {
    const rows = await readDb();
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error(`contract ${id} not found`);
    const merged: Contract = {
      ...rows[idx],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    rows[idx] = merged;
    await writeDb(rows);
    return merged;
  });
}

// Run a read-modify-write transaction against one contract atomically. The
// transform receives the freshest persisted row and returns the patch to apply
// (and may perform side effects like writing a snapshot file). Everything runs
// inside the DB lock, so a concurrent signer cannot read stale state and clobber
// this signature. This is the safe primitive for multi-step mutations like
// signing; prefer it over getContract()+updateContract() across a request.
export function mutateContract<T>(
  id: string,
  transform: (current: Contract) => Promise<{ patch: Partial<Contract>; result: T }>,
): Promise<T> {
  return withDbLock(async () => {
    const rows = await readDb();
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error(`contract ${id} not found`);
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

// Append an audit entry without clobbering concurrent signature writes: read
// the freshest row and append inside the same lock the writers use, instead of
// going through updateContract with a possibly-stale snapshot.
export function appendAudit(
  id: string,
  entry: ContractAuditEntry,
): Promise<Contract> {
  return withDbLock(async () => {
    const rows = await readDb();
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error(`contract ${id} not found`);
    const merged: Contract = {
      ...rows[idx],
      audit: [...rows[idx].audit, entry],
      updatedAt: new Date().toISOString(),
    };
    rows[idx] = merged;
    await writeDb(rows);
    return merged;
  });
}

// Convenience re-exports so callers don't have to import from two storage files.
export { readFileBytes, saveFileBytes };
