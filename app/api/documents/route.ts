import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createDocument, listDocuments, saveFileBytes } from "@/lib/storage";
import { sha256 } from "@/lib/crypto";
import { isApiAuthConfigured, verifyApiRequest } from "@/lib/auth";
import { generateSignerToken, tokenExpiryFromNow } from "@/lib/tokens";
import type { DocumentRecord } from "@/lib/types";

export const runtime = "nodejs";

const FieldSchema = z.object({
  page: z.number().int().min(0),
  xRatio: z.number().min(0).max(1),
  yRatio: z.number().min(0).max(1),
  widthRatio: z.number().min(0).max(1),
  heightRatio: z.number().min(0).max(1),
});

// PDF supplied either inline as base64 (`pdfBase64`) or as an absolute path on
// the server (`pdfPath`) that MUST resolve inside DOCUMENTS_PDF_ROOT. A free path
// field is a classic path-traversal/LFI vector even from a trusted caller, so we
// allowlist the root rather than trust the Manager blindly.
// ~25MB of base64 ≈ 18MB of PDF — generous for a contract, bounded so a giant
// blob can't be parsed/hashed/written inside the DB lock and starve every other
// mutation. A real contract PDF here is ~250KB.
const MAX_PDF_BASE64_LEN = 25_000_000;

const CreateBodySchema = z
  .object({
    name: z.string().min(1).max(200),
    pdfBase64: z.string().min(1).max(MAX_PDF_BASE64_LEN).optional(),
    pdfPath: z.string().min(1).optional(),
    signer: z.object({
      name: z.string().min(1).max(120),
      email: z.string().email(),
    }),
    fields: z.array(FieldSchema).min(1).max(20),
    externalRef: z
      .object({
        system: z.string().min(1),
        leadId: z.string().optional(),
        note: z.string().optional(),
      })
      .optional(),
  })
  .refine((b) => Boolean(b.pdfBase64) !== Boolean(b.pdfPath), {
    message: "supply exactly one of pdfBase64 or pdfPath",
  });

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

async function loadPdfBytes(
  body: z.infer<typeof CreateBodySchema>,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; status: number; error: string }> {
  if (body.pdfBase64) {
    const bytes = Uint8Array.from(Buffer.from(body.pdfBase64, "base64"));
    if (!PDF_MAGIC.every((b, i) => bytes[i] === b)) {
      return { ok: false, status: 400, error: "pdfBase64 is not a PDF" };
    }
    return { ok: true, bytes };
  }
  // pdfPath: confine to the allowlisted root.
  const root = process.env.DOCUMENTS_PDF_ROOT;
  if (!root) {
    return { ok: false, status: 400, error: "pdfPath given but DOCUMENTS_PDF_ROOT is not configured" };
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(body.pdfPath!);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    return { ok: false, status: 400, error: "pdfPath escapes DOCUMENTS_PDF_ROOT" };
  }
  try {
    const buf = await fs.readFile(resolved);
    const bytes = new Uint8Array(buf);
    if (!PDF_MAGIC.every((b, i) => bytes[i] === b)) {
      return { ok: false, status: 400, error: "pdfPath target is not a PDF" };
    }
    return { ok: true, bytes };
  } catch {
    return { ok: false, status: 400, error: "pdfPath could not be read" };
  }
}

export async function GET() {
  const docs = await listDocuments();
  // Strip signer tokens — listing must never leak signing links.
  const safe = docs.map((d) => ({
    ...d,
    signer: d.signer ? { ...d.signer, token: undefined } : undefined,
  }));
  return NextResponse.json({ documents: safe });
}

export async function POST(req: NextRequest) {
  // Raw body first — the HMAC is over the exact bytes, so verify before parsing.
  // Don't "tidy" this into req.json(); it would break auth.
  const raw = await req.text();

  // Fail closed: with DOCUSIGN_API_SECRET set, require a valid HMAC. Without it,
  // reject unless the operator explicitly opted into unauthenticated local use.
  if (isApiAuthConfigured()) {
    const auth = verifyApiRequest(req, raw);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
  } else if (process.env.ALLOW_UNAUTHENTICATED_DOCUMENTS !== "1") {
    return NextResponse.json(
      {
        error:
          "document creation is not authenticated: set DOCUSIGN_API_SECRET, " +
          "or ALLOW_UNAUTHENTICATED_DOCUMENTS=1 for local use",
      },
      { status: 503 },
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const body = CreateBodySchema.safeParse(parsedJson);
  if (!body.success) {
    return NextResponse.json(
      { error: "invalid body", details: body.error.flatten() },
      { status: 400 },
    );
  }

  const pdf = await loadPdfBytes(body.data);
  if (!pdf.ok) {
    return NextResponse.json({ error: pdf.error }, { status: pdf.status });
  }

  const hash = sha256(pdf.bytes);
  const stored = await saveFileBytes(body.data.name, pdf.bytes);
  const now = new Date().toISOString();
  const token = generateSignerToken();

  const draft: Omit<DocumentRecord, "id" | "createdAt" | "updatedAt"> = {
    name: body.data.name,
    status: "draft",
    originalFile: stored,
    originalSha256: hash,
    signer: {
      name: body.data.signer.name,
      email: body.data.signer.email,
      token,
      tokenExpiresAt: tokenExpiryFromNow(),
    },
    fields: body.data.fields,
    externalRef: body.data.externalRef,
    audit: [
      { at: now, action: "created", actor: body.data.externalRef?.system ?? "api", originalSha256: hash },
      { at: now, action: "sent_for_signature", actor: body.data.externalRef?.system ?? "api" },
    ],
  };

  const rec = await createDocument(draft);

  const base = process.env.SIGN_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const signUrl = `${base.replace(/\/$/, "")}/sign/${rec.id}?t=${encodeURIComponent(token)}`;

  // The token IS returned here — this is the only place the Manager can pick it
  // up to build the signing link. (The GET/list path strips it.)
  return NextResponse.json({
    documentId: rec.id,
    token,
    signUrl,
    expiresAt: rec.signer?.tokenExpiresAt,
  });
}
