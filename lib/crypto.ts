import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function sha256(bytes: Uint8Array | Buffer): string {
  const h = createHash("sha256");
  h.update(bytes);
  return h.digest("hex");
}

// Keyed seal over a value (we anchor the signed file's SHA-256 hex). Detects a
// disk edit that silently re-hashed the file: re-forging this HMAC requires the
// server secret. See lib/anchor.ts for the honest threat model — this is
// tamper-EVIDENCE against an attacker WITHOUT the secret, not tamper-proofing.
export function hmacSha256(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

// Constant-time hex compare. Returns false on any length/format mismatch instead
// of throwing, so callers can treat it as a plain boolean.
export function hmacEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
