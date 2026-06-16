import { NextRequest, NextResponse } from "next/server";
import { getDocument } from "@/lib/storage";
import { mayReadDocument } from "@/lib/doc-access";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  // The record carries the signer's PII (email, IP, user-agent) and the full
  // audit trail with every IP/UA/timestamp — so a bare 12-char id is NOT a
  // credential. Gate it exactly like the file route: require the signer token or
  // the operator secret.
  if (!mayReadDocument(req, doc)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Strip the signer token even for authorized reads — fetching a document must
  // never echo the signing link back.
  const safe = {
    ...doc,
    signer: doc.signer ? { ...doc.signer, token: undefined } : undefined,
  };
  return NextResponse.json({ document: safe });
}
