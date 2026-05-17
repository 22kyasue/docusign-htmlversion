import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Contract, ContractAuditEntry } from "./contract-types";
import { saveFileBytes } from "./storage";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "contracts.json");

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

export async function createContract(input: CreateInput): Promise<Contract> {
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
}

export async function updateContract(
  id: string,
  patch: Partial<Contract>,
): Promise<Contract> {
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
}

export async function appendAudit(
  id: string,
  entry: ContractAuditEntry,
): Promise<Contract> {
  const c = await getContract(id);
  if (!c) throw new Error(`contract ${id} not found`);
  return await updateContract(id, { audit: [...c.audit, entry] });
}

// Convenience re-export so callers don't have to import from two storage files.
export { saveFileBytes };
