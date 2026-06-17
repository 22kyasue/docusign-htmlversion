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
  const download = req.nextUrl.searchParams.get("download") === "1";
  const wantSigned = variant === "signed" || (variant === "auto" && doc.signedFile);
  const target = wantSigned && doc.signedFile ? doc.signedFile : doc.originalFile;
  const bytes = await readFileBytes(target);

  const filename =
    wantSigned && doc.signedFile
      ? doc.name.replace(/\.pdf$/i, "") + ".signed.pdf"
      : doc.name;

  // download=1 → attachment (browser saves it); otherwise inline (views in tab).
  // RFC 5987 filename* so a Japanese document name renders correctly instead of
  // mojibake; the quoted ASCII fallback covers ancient clients. The raw filename
  // never reaches a header unescaped (control/non-ascii stripped in the fallback,
  // percent-encoded in filename*).
  const disposition = download ? "attachment" : "inline";
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  const contentDisposition = `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": contentDisposition,
      "cache-control": "no-store",
    },
  });
}
