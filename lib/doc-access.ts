import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import type { DocumentRecord } from "./types";
import { isTokenExpired } from "./tokens";

// Access control for a document's bytes (the signed PDF + the signature PNG).
//
// A bare 12-char document id is NOT a credential — these artifacts carry the
// signer's identity, IP, and the legal content, so they must not be readable by
// id-guessing. A request may read them if EITHER:
//   1. it presents the signer's valid magic-link token (?t= or X-Signer-Token), OR
//   2. it presents the operator secret (X-Operator-Secret == DOCUSIGN_API_SECRET).
//
// The operator path is the single-operator local equivalent of a console
// session — there is no multi-user auth in this tool by design. When
// DOCUSIGN_API_SECRET is unset, operator access is allowed ONLY if the operator
// has explicitly opted into unauthenticated local use via
// ALLOW_UNAUTHENTICATED_DOCUMENTS=1 — the SAME flag the create/upload routes
// gate on. This fails CLOSED: a public deploy that forgot to set the secret does
// NOT silently expose every signed PDF + signature PNG to id-guessing.

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function isOperator(req: NextRequest): boolean {
  const secret = process.env.DOCUSIGN_API_SECRET;
  if (!secret || secret.length < 16) {
    // No secret configured: allow operator access ONLY when explicitly opted in
    // for local use. Fail closed otherwise — same posture as the create route.
    return process.env.ALLOW_UNAUTHENTICATED_DOCUMENTS === "1";
  }
  const presented = req.headers.get("x-operator-secret");
  return Boolean(presented && safeEq(presented, secret));
}

// True if the request may read this document's signed artifacts.
export function mayReadDocument(req: NextRequest, doc: DocumentRecord): boolean {
  if (isOperator(req)) return true;
  const token =
    req.nextUrl.searchParams.get("t") ?? req.headers.get("x-signer-token") ?? undefined;
  if (!token || !doc.signer) return false;
  if (!safeEq(token, doc.signer.token)) return false;
  // An expired token still proves identity for reading what the signer already
  // signed (mirrors contracts allowing already_signed to view), but we keep it
  // strict: a live, matching token is required to read.
  if (isTokenExpired(doc.signer.tokenExpiresAt) && !doc.signer.signedAt) return false;
  return true;
}
