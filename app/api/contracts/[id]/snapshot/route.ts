import { NextRequest, NextResponse } from "next/server";
import { getContract } from "@/lib/contract-storage";
import { readFileBytes } from "@/lib/storage";

export const runtime = "nodejs";

// Serve the immutable HTML snapshot captured when the last signer signed.
// Available only for completed contracts.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const c = await getContract(id);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!c.htmlSnapshotFile) {
    return NextResponse.json(
      { error: "contract not yet completed" },
      { status: 409 },
    );
  }

  const bytes = await readFileBytes(c.htmlSnapshotFile);
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `inline; filename="contract-${c.id}.signed.html"`,
      "cache-control": "no-store",
      // SHA-256 hash header so callers can verify the file matches what the
      // contract record claims.
      "x-content-sha256": c.htmlSnapshotSha256 ?? "",
    },
  });
}
