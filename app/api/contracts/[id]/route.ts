import { NextRequest, NextResponse } from "next/server";
import { getContract } from "@/lib/contract-storage";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const c = await getContract(id);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Strip signer tokens — fetching a contract by id should never leak them.
  const safe = {
    ...c,
    signers: c.signers.map((s) => ({ ...s, token: undefined })),
  };
  return NextResponse.json({ contract: safe });
}
