import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  mutateContract,
  readFileBytes,
  saveFileBytes,
} from "@/lib/contract-storage";
import { sha256 } from "@/lib/crypto";
import { isValidPng } from "@/lib/png-validate";
import { isTokenExpired } from "@/lib/tokens";
import {
  injectSignatureImage,
  renderContractBody,
  renderStandaloneHtml,
} from "@/lib/contract-template";
import type { Contract, ContractAuditEntry, Signer } from "@/lib/contract-types";

export const runtime = "nodejs";

// ~1.4MB of base64 ≈ 1MB of PNG. A drawn signature is a few KB; this cap stops
// a token holder from buffering a huge payload that blocks the global DB lock.
const MAX_SIGNATURE_DATA_URL_LEN = 1_400_000;

const BodySchema = z.object({
  token: z.string().min(8),
  signaturePngDataUrl: z
    .string()
    .startsWith("data:image/png;base64,")
    .max(MAX_SIGNATURE_DATA_URL_LEN),
});

// Outcome of the atomic sign transaction. A rejection carries the HTTP status
// the route should return; success carries the completion flag and the updated
// record (token-stripping happens at the boundary).
type SignOutcome =
  | { ok: true; completed: boolean; contract: Contract }
  | { ok: false; status: number; error: string; signedAt?: string };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { token, signaturePngDataUrl } = parsed.data;

  // Decode and validate the signature image up front. The client enforces "draw
  // a mark" via pad.isEmpty(), but a legal endpoint must not trust the client:
  // reject anything that isn't a non-empty PNG so a blank/forged image can never
  // complete a contract.
  const pngBytes = Uint8Array.from(
    Buffer.from(signaturePngDataUrl.split(",")[1] ?? "", "base64"),
  );
  if (!isValidPng(pngBytes)) {
    return NextResponse.json(
      { error: "signature must be a valid, non-empty PNG image" },
      { status: 400 },
    );
  }

  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const ua = req.headers.get("user-agent") ?? undefined;

  // Everything that reads-then-writes contract state runs inside one DB lock so
  // a concurrent signer cannot read stale state and drop this signature.
  let outcome: SignOutcome;
  try {
    outcome = await mutateContract<SignOutcome>(id, async (c) => {
      if (c.status === "voided") {
        return { patch: {}, result: { ok: false, status: 410, error: "contract voided" } };
      }
      // Completion is terminal: the snapshot is the canonical original and must
      // never be re-rendered or re-hashed. Without this a still-valid token
      // could overwrite a finished legal document.
      if (c.status === "completed") {
        return {
          patch: {},
          result: { ok: false, status: 409, error: "contract already completed" },
        };
      }

      const signer = c.signers.find((s) => s.token === token);
      if (!signer) {
        return { patch: {}, result: { ok: false, status: 401, error: "invalid signing token" } };
      }
      if (isTokenExpired(signer.tokenExpiresAt)) {
        return { patch: {}, result: { ok: false, status: 401, error: "token expired" } };
      }
      if (signer.signedAt) {
        return {
          patch: {},
          result: { ok: false, status: 409, error: "already signed", signedAt: signer.signedAt },
        };
      }

      const now = new Date().toISOString();
      const sigFile = await saveFileBytes(`sig_${c.id}_${signer.id}.png`, pngBytes);

      const updatedSigners: Signer[] = c.signers.map((s) =>
        s.id === signer.id
          ? { ...s, signedAt: now, signatureImageFile: sigFile, ip, userAgent: ua }
          : s,
      );

      const allSigned = updatedSigners.every((s) => Boolean(s.signedAt));
      const newStatus: Contract["status"] = allSigned ? "completed" : "pending_signatures";

      const audit: ContractAuditEntry[] = [
        { at: now, action: "signed", actor: signer.name, signerId: signer.id, ip, userAgent: ua },
      ];

      const patch: Partial<Contract> = { signers: updatedSigners, status: newStatus };

      if (allSigned) {
        // Freeze the canonical snapshot with every signer's PNG inlined as a
        // self-contained data URL, then hash the exact bytes served. If any
        // signature file is unreadable we THROW: the whole transaction rolls
        // back and this commit returns an error to retry. We must never seal a
        // canonical original with a missing signature — a clean failure is far
        // better than a silently blank legal document.
        const liveContract: Contract = { ...c, signers: updatedSigners, status: newStatus };
        let body = renderContractBody(liveContract);
        for (const s of updatedSigners) {
          if (!s.signatureImageFile) continue;
          const buf = await readFileBytes(s.signatureImageFile);
          const dataUrl = `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;
          body = injectSignatureImage(body, s.id, dataUrl);
        }
        const htmlBytes = Buffer.from(renderStandaloneHtml(liveContract, body), "utf8");
        const htmlSnapshotSha256 = sha256(new Uint8Array(htmlBytes));
        patch.htmlSnapshotFile = await saveFileBytes(
          `contract_${c.id}.signed.html`,
          new Uint8Array(htmlBytes),
        );
        patch.htmlSnapshotSha256 = htmlSnapshotSha256;
        audit.push({ at: new Date().toISOString(), action: "completed", htmlSnapshotSha256 });
      }

      patch.audit = [...c.audit, ...audit];
      const merged: Contract = { ...c, ...patch };
      return { patch, result: { ok: true, completed: allSigned, contract: merged } };
    });
  } catch (err: unknown) {
    if (err instanceof Error && /^contract .* not found$/.test(err.message)) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    throw err;
  }

  if (!outcome.ok) {
    const payload = outcome.signedAt
      ? { error: outcome.error, signedAt: outcome.signedAt }
      : { error: outcome.error };
    return NextResponse.json(payload, { status: outcome.status });
  }

  const safe = {
    ...outcome.contract,
    signers: outcome.contract.signers.map((s) => ({ ...s, token: undefined })),
  };
  return NextResponse.json({ contract: safe, completed: outcome.completed });
}
