import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDocument, readFileBytes, saveFileBytes, updateDocument } from "@/lib/storage";
import { sha256 } from "@/lib/crypto";
import { stampSignature, appendAuditPage } from "@/lib/pdf";

export const runtime = "nodejs";

const FieldSchema = z.object({
  page: z.number().int().min(0),
  xRatio: z.number().min(0).max(1),
  yRatio: z.number().min(0).max(1),
  widthRatio: z.number().min(0).max(1),
  heightRatio: z.number().min(0).max(1),
});

const BodySchema = z.object({
  signaturePngDataUrl: z.string().startsWith("data:image/png;base64,"),
  fields: z.array(FieldSchema).min(1),
  actor: z.string().min(1).max(120).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = BodySchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "invalid body", details: body.error.flatten() }, { status: 400 });
  }

  const png = Uint8Array.from(
    Buffer.from(body.data.signaturePngDataUrl.split(",")[1], "base64"),
  );

  const original = await readFileBytes(doc.originalFile);
  const stamped = await stampSignature({
    pdfBytes: original,
    signaturePng: png,
    fields: body.data.fields,
  });

  const signedHash = sha256(stamped);

  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const ua = req.headers.get("user-agent") ?? undefined;
  const newEntry = {
    at: new Date().toISOString(),
    action: "signed" as const,
    actor: body.data.actor,
    ip,
    userAgent: ua,
    originalSha256: doc.originalSha256,
    signedSha256: signedHash,
  };

  const withAudit = await appendAuditPage({
    pdfBytes: stamped,
    documentId: doc.id,
    documentName: doc.name,
    originalSha256: doc.originalSha256,
    signedSha256: signedHash,
    entries: [...doc.audit, newEntry],
  });

  const finalHash = sha256(withAudit);
  const signedFile = await saveFileBytes(`signed_${doc.name}`, withAudit);

  const updated = await updateDocument(doc.id, {
    status: "signed",
    signedFile,
    signedSha256: finalHash,
    audit: [...doc.audit, { ...newEntry, signedSha256: finalHash }],
  });

  return NextResponse.json({ document: updated });
}
