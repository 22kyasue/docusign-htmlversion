import { NextRequest, NextResponse } from "next/server";
import { createDocument, listDocuments, saveFileBytes } from "@/lib/storage";
import { sha256 } from "@/lib/crypto";

export const runtime = "nodejs";

export async function GET() {
  const docs = await listDocuments();
  return NextResponse.json({ documents: docs });
}

export async function POST(req: NextRequest) {
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

  const rec = await createDocument({
    name: file.name,
    status: "draft",
    originalFile: stored,
    originalSha256: hash,
    audit: [
      {
        at: new Date().toISOString(),
        action: "uploaded",
        ip: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
        originalSha256: hash,
      },
    ],
  });

  return NextResponse.json({ document: rec });
}
