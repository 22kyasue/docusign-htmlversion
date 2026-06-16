// Server-side secrets. Two DISTINCT keys with different blast radius:
//
//   DOCUSIGN_API_SECRET — HMAC on the Manager→SovereignSign API + the
//                         SovereignSign→cockpit completion webhook. A wire key.
//   SERVER_SECRET       — keys the tamper-evidence HMAC anchor on signed files.
//                         A storage key. Kept separate so rotating the wire key
//                         never invalidates the seals on already-signed
//                         contracts, and so a leak of one is not a leak of both.
//
// Reusing one key for both would mean a webhook-key rotation silently breaks
// verification of every previously sealed document. Don't.

export function getServerSecret(): string | null {
  const s = process.env.SERVER_SECRET;
  return s && s.length >= 16 ? s : null;
}
