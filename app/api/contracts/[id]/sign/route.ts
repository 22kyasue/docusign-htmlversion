import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  appendAudit,
  getContract,
  saveFileBytes,
  updateContract,
} from "@/lib/contract-storage";
import { sha256 } from "@/lib/crypto";
import { isTokenExpired } from "@/lib/tokens";
import {
  injectSignatureImage,
  renderContractBody,
  renderStandaloneHtml,
} from "@/lib/contract-template";

export const runtime = "nodejs";

const BodySchema = z.object({
  token: z.string().min(8),
  signaturePngDataUrl: z.string().startsWith("data:image/png;base64,"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const c = await getContract(id);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (c.status === "voided") {
    return NextResponse.json({ error: "contract voided" }, { status: 410 });
  }

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const signer = c.signers.find((s) => s.token === parsed.data.token);
  if (!signer) {
    return NextResponse.json({ error: "invalid signing token" }, { status: 401 });
  }
  if (isTokenExpired(signer.tokenExpiresAt)) {
    return NextResponse.json({ error: "token expired" }, { status: 401 });
  }
  if (signer.signedAt) {
    return NextResponse.json(
      { error: "already signed", signedAt: signer.signedAt },
      { status: 409 },
    );
  }

  // Persist signature PNG to disk.
  const pngBytes = Uint8Array.from(
    Buffer.from(parsed.data.signaturePngDataUrl.split(",")[1], "base64"),
  );
  const sigFile = await saveFileBytes(
    `sig_${c.id}_${signer.id}.png`,
    pngBytes,
  );

  const now = new Date().toISOString();
  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const ua = req.headers.get("user-agent") ?? undefined;

  // Update the signer in place.
  const updatedSigners = c.signers.map((s) =>
    s.id === signer.id
      ? {
          ...s,
          signedAt: now,
          signatureImageFile: sigFile,
          ip,
          userAgent: ua,
        }
      : s,
  );

  // Are we now done? All signers have a signedAt timestamp → completed.
  const allSigned = updatedSigners.every((s) => Boolean(s.signedAt));
  const newStatus = allSigned ? "completed" : "pending_signatures";

  // Build the live HTML snapshot AFTER applying this signer's signedAt so
  // the snapshot reflects current state, and patch in the signature image
  // data URL for this signer (other signers' images get patched when they
  // sign in their turn — the final snapshot is taken once status hits
  // "completed").
  const liveContract = {
    ...c,
    signers: updatedSigners,
    status: newStatus as typeof c.status,
  };

  let htmlSnapshotFile: string | undefined = c.htmlSnapshotFile;
  let htmlSnapshotSha256: string | undefined = c.htmlSnapshotSha256;

  if (allSigned) {
    // Render the contract with every signer's PNG inlined as a data URL
    // so the snapshot is self-contained (no /files/ refs).
    let body = renderContractBody(liveContract);
    for (const s of updatedSigners) {
      if (!s.signatureImageFile) continue;
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const buf = await fs.readFile(
        path.join(process.cwd(), "data", "files", s.signatureImageFile),
      );
      const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
      body = injectSignatureImage(body, s.id, dataUrl);
    }
    const fullHtml = renderStandaloneHtml(liveContract, body);
    const htmlBytes = Buffer.from(fullHtml, "utf8");
    htmlSnapshotSha256 = sha256(new Uint8Array(htmlBytes));
    htmlSnapshotFile = await saveFileBytes(
      `contract_${c.id}.signed.html`,
      new Uint8Array(htmlBytes),
    );
  }

  const updated = await updateContract(c.id, {
    signers: updatedSigners,
    status: newStatus,
    htmlSnapshotFile,
    htmlSnapshotSha256,
  });

  await appendAudit(c.id, {
    at: now,
    action: "signed",
    actor: signer.name,
    signerId: signer.id,
    ip,
    userAgent: ua,
  });
  if (allSigned) {
    await appendAudit(c.id, {
      at: new Date().toISOString(),
      action: "completed",
      htmlSnapshotSha256,
    });
  }

  // Strip tokens from the returned record.
  const safe = {
    ...updated,
    signers: updated.signers.map((s) => ({ ...s, token: undefined })),
  };

  return NextResponse.json({ contract: safe, completed: allSigned });
}
