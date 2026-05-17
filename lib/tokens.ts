import { randomBytes } from "node:crypto";

// 24 random bytes → 32-char base64url. Plenty of entropy, short enough to fit
// in an email URL cleanly. Tokens are stored alongside the signer record and
// are the only credential needed to access the sign page for one signer.
export function generateSignerToken(): string {
  return randomBytes(24).toString("base64url");
}

// Default token lifetime — long enough that real-world signing delays
// (waiting on bank stamp confirmation, weekend, etc.) don't expire links.
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export function tokenExpiryFromNow(ttlMs: number = DEFAULT_TTL_MS): string {
  return new Date(Date.now() + ttlMs).toISOString();
}

export function isTokenExpired(expiresAtIso: string): boolean {
  return Date.parse(expiresAtIso) < Date.now();
}
