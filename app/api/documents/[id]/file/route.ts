import { NextRequest, NextResponse } from "next/server";
import { getDocument, readFileBytes } from "@/lib/storage";
import { mayReadDocument } from "@/lib/doc-access";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  // The original and signed PDFs carry the legal content + signer identity, so
  // a bare id is not enough — require the signer's token or the operator secret.
  if (!mayReadDocument(req, doc)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const variant = req.nextUrl.searchParams.get("variant") ?? "auto";
  const wantSigned = variant === "signed" || (variant === "auto" && doc.signedFile);
  const target = wantSigned && doc.signedFile ? doc.signedFile : doc.originalFile;
  const bytes = await readFileBytes(target);

  const filename =
    wantSigned && doc.signedFile
      ? doc.name.replace(/\.pdf$/i, "") + ".signed.pdf"
      : doc.name;

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
