import { NextRequest, NextResponse } from "next/server";
import { createDocument, saveFileBytes } from "@/lib/storage";
import { sha256 } from "@/lib/crypto";
import { isOperator } from "@/lib/doc-access";
import { generateSignerToken, tokenExpiryFromNow } from "@/lib/tokens";
import { SHIRAKABESO_KOU_FIELD } from "@/lib/field-presets";
import type { DocumentRecord } from "@/lib/types";

export const runtime = "nodejs";

// Browser multipart upload (the operator console). Separate from the HMAC-JSON
// Manager route (POST /api/documents) because an HMAC cannot be computed over a
// re-encoded multipart stream — verifying must read the exact raw bytes, which
// formData() consumes. This route is gated on the operator secret instead.
export async function POST(req: NextRequest) {
  if (!isOperator(req)) {
    return NextResponse.json({ error: "operator access required" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file field required" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "PDF only" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = sha256(bytes);
  const stored = await saveFileBytes(file.name, bytes);
  const now = new Date().toISOString();
  const token = generateSignerToken();

  // Operator uploads default to the Shirakabesō 甲 field so the local flow signs
  // the real contract correctly without re-measuring. Optional signer name/email
  // from the form; defaults are placeholders for ad-hoc local signing.
  const signerName = (form.get("signerName") as string | null)?.trim() || "署名者";
  const signerEmail = (form.get("signerEmail") as string | null)?.trim() || "signer@example.com";

  const rec = await createDocument({
    name: file.name,
    status: "draft",
    originalFile: stored,
    originalSha256: hash,
    signer: { name: signerName, email: signerEmail, token, tokenExpiresAt: tokenExpiryFromNow() },
    fields: [SHIRAKABESO_KOU_FIELD],
    audit: [
      {
        at: now,
        action: "uploaded",
        ip: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
        originalSha256: hash,
      },
    ],
  } satisfies Omit<DocumentRecord, "id" | "createdAt" | "updatedAt">);

  return NextResponse.json({
    document: { id: rec.id },
    token,
    signPath: `/sign/${rec.id}?t=${encodeURIComponent(token)}`,
  });
}
