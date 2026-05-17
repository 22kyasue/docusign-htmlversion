import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

// HMAC authentication for cockpit-side API calls.
//
// The cockpit holds the same shared secret in DOCUSIGN_API_SECRET and signs
// every request:
//
//   X-Docusign-Timestamp: <unix-seconds>
//   X-Docusign-Signature: hex(HMAC_SHA256(secret, `${timestamp}.${rawBody}`))
//
// We reject if:
//   - secret is unset on the server (configuration error → 500)
//   - timestamp is missing, malformed, or older than 5 minutes (replay window)
//   - signature does not match (constant-time compare)

const REPLAY_WINDOW_SECONDS = 5 * 60;

export type ApiAuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

function getSecret(): string | null {
  const s = process.env.DOCUSIGN_API_SECRET;
  return s && s.length >= 16 ? s : null;
}

export function isApiAuthConfigured(): boolean {
  return getSecret() !== null;
}

export function verifyApiRequest(req: NextRequest, rawBody: string): ApiAuthResult {
  const secret = getSecret();
  if (!secret) {
    return {
      ok: false,
      status: 500,
      error: "DOCUSIGN_API_SECRET not configured on server",
    };
  }

  const ts = req.headers.get("x-docusign-timestamp");
  const sig = req.headers.get("x-docusign-signature");
  if (!ts || !sig) {
    return { ok: false, status: 401, error: "missing auth headers" };
  }

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, status: 401, error: "bad timestamp" };
  }
  const ageSec = Math.abs(Date.now() / 1000 - tsNum);
  if (ageSec > REPLAY_WINDOW_SECONDS) {
    return { ok: false, status: 401, error: "timestamp outside replay window" };
  }

  const expected = createHmac("sha256", secret)
    .update(`${ts}.${rawBody}`)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "bad signature" };
  }

  return { ok: true };
}
