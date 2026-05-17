import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { DocumentRecord } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const FILES_DIR = path.join(DATA_DIR, "files");
const DB_PATH = path.join(DATA_DIR, "documents.json");

async function ensureDirs() {
  await fs.mkdir(FILES_DIR, { recursive: true });
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
  await fs.writeFile(tmp, JSON.stringify(rows, null, 2), "utf8");
  await fs.rename(tmp, DB_PATH);
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  const rows = await readDb();
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDocument(id: string): Promise<DocumentRecord | null> {
  const rows = await readDb();
  return rows.find((r) => r.id === id) ?? null;
}

export async function createDocument(
  partial: Omit<DocumentRecord, "id" | "createdAt" | "updatedAt" | "audit"> & {
    audit?: DocumentRecord["audit"];
  },
): Promise<DocumentRecord> {
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
}

export async function updateDocument(
  id: string,
  patch: Partial<DocumentRecord>,
): Promise<DocumentRecord> {
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
}

export async function saveFileBytes(name: string, bytes: Uint8Array): Promise<string> {
  await ensureDirs();
  const safe = name.replace(/[^\w.\-]/g, "_");
  const full = `${Date.now()}_${nanoid(6)}_${safe}`;
  await fs.writeFile(path.join(FILES_DIR, full), bytes);
  return full;
}

export async function readFileBytes(filename: string): Promise<Uint8Array> {
  const buf = await fs.readFile(path.join(FILES_DIR, filename));
  return new Uint8Array(buf);
}

export function filePath(filename: string): string {
  return path.join(FILES_DIR, filename);
}
