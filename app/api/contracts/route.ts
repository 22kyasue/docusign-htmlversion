import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createContract,
  listContracts,
} from "@/lib/contract-storage";
import { generateSignerToken, tokenExpiryFromNow } from "@/lib/tokens";
import { isApiAuthConfigured, verifyApiRequest } from "@/lib/auth";
import type { Contract, Signer } from "@/lib/contract-types";

export const runtime = "nodejs";

const SignerInputSchema = z.object({
  role: z.enum(["studio", "client"]),
  name: z.string().min(1).max(120),
  email: z.string().email(),
});

const VariablesSchema = z.object({
  studioCompany: z.string().min(1),
  studioLegalName: z.string().optional(),
  studioAddress: z.string().optional(),
  studioRepresentative: z.string().min(1),

  clientCompany: z.string().min(1),
  clientLegalName: z.string().optional(),
  clientAddress: z.string().optional(),
  clientRepresentative: z.string().min(1),

  projectName: z.string().min(1),
  deliverables: z.array(z.string().min(1)).min(1),
  languagePairs: z.array(z.string().min(1)).min(1),
  scopeNotes: z.string().optional(),
  outOfScopeNotes: z.string().optional(),

  priceJpy: z.number().int().nonnegative(),
  taxRatePercent: z.number().min(0).max(100),
  paymentSchedule: z.string().min(1),
  paymentMethod: z.string().min(1),

  kickoffDate: z.string().min(4),
  deliveryDeadline: z.string().min(4),
  revisionRounds: z.number().int().nonnegative(),

  governingLaw: z.string().min(1),
  jurisdiction: z.string().min(1),
});

const CreateBodySchema = z.object({
  variables: VariablesSchema,
  signers: z.array(SignerInputSchema).min(1).max(8),
  externalRef: z
    .object({
      system: z.string().min(1),
      leadId: z.string().optional(),
      note: z.string().optional(),
    })
    .optional(),
});

export async function GET() {
  const rows = await listContracts();
  // Strip tokens from the list response — listing should never leak signer links.
  const safe = rows.map((c) => ({
    ...c,
    signers: c.signers.map((s) => ({ ...s, token: undefined })),
  }));
  return NextResponse.json({ contracts: safe });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  // Enforce HMAC when configured. Local dev (no secret set) skips auth so the
  // manual creation UI can call this endpoint directly.
  if (isApiAuthConfigured()) {
    const auth = verifyApiRequest(req, raw);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const body = CreateBodySchema.safeParse(parsedJson);
  if (!body.success) {
    return NextResponse.json(
      { error: "invalid body", details: body.error.flatten() },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const signers: Signer[] = body.data.signers.map((s, i) => ({
    id: `s${i + 1}`,
    role: s.role,
    name: s.name,
    email: s.email,
    token: generateSignerToken(),
    tokenExpiresAt: tokenExpiryFromNow(),
  }));

  const draft: Omit<Contract, "id" | "createdAt" | "updatedAt"> = {
    template: "launch_tier_v1",
    status: "pending_signatures",
    variables: body.data.variables,
    signers,
    externalRef: body.data.externalRef,
    audit: [
      {
        at: now,
        action: "created",
        actor: body.data.externalRef?.system ?? "manual",
      },
      {
        at: now,
        action: "sent_for_signature",
        actor: body.data.externalRef?.system ?? "manual",
      },
    ],
  };

  const rec = await createContract(draft);

  // Tokens ARE returned on the create response — this is the only place the
  // cockpit can pick them up to build the magic link emails it sends out.
  return NextResponse.json({
    contract: rec,
    signerLinks: rec.signers.map((s) => ({
      signerId: s.id,
      role: s.role,
      email: s.email,
      token: s.token,
      expiresAt: s.tokenExpiresAt,
      path: `/contracts/${rec.id}?t=${encodeURIComponent(s.token)}`,
    })),
  });
}
