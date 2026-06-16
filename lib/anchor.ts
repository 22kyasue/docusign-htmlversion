import { promises as fs } from "node:fs";
import { sha256, hmacSha256, hmacEquals } from "./crypto";
import { getServerSecret } from "./secrets";
import { withEbusyRetry } from "./storage";

// Tamper-EVIDENCE for signed files. NOT tamper-proofing — read the guarantee:
//
//   For each signed PDF we store, in a sidecar `<file>.anchor.json`, the file's
//   SHA-256 and an HMAC of that hash keyed by SERVER_SECRET. To forge a clean
//   anchor for an altered file you must recompute hmac(SERVER_SECRET, newHash),
//   which requires the secret.
//
// WHAT THIS DETECTS:
//   - Any modification of the signed file by someone who does NOT hold
//     SERVER_SECRET. The file hash changes; they cannot re-forge the HMAC.
//
// WHAT THIS DOES NOT DO (stated plainly so we never oversell it to a client):
//   - It does NOT protect against an attacker who holds SERVER_SECRET (e.g. root
//     on the box, who can read process env). They can re-anchor any forgery.
//   - It does NOT protect against deletion of the whole record (file + anchor +
//     DB row). Defending against the secret-holder OR deletion requires an
//     OFF-BOX, append-only copy of the anchor + audit log written at seal time.
//   - It is NOT an externally-notarized timestamp (no RFC 3161 / OpenTimestamps).
//     It proves the bytes are unchanged since WE sealed them, not when, to a
//     third party.

export type FileAnchor = {
  algo: "sha256+hmac-sha256";
  sha256: string;
  // hmac-sha256(secret, sha256hex). Absent when SERVER_SECRET was unset at seal
  // time (local dev) — then we have integrity-by-hash only, which a disk
  // attacker could re-forge. Verification reports this honestly.
  hmac?: string;
  sealedAt: string;
};

function anchorPath(filePath: string): string {
  return `${filePath}.anchor.json`;
}

// Compute the anchor for the given bytes. Pure: no disk write. Caller writes it
// alongside the file via writeAnchorFile, inside the storage transaction.
export function computeAnchor(bytes: Uint8Array): FileAnchor {
  const hash = sha256(bytes);
  const secret = getServerSecret();
  return {
    algo: "sha256+hmac-sha256",
    sha256: hash,
    hmac: secret ? hmacSha256(hash, secret) : undefined,
    sealedAt: new Date().toISOString(),
  };
}

export async function writeAnchorFile(filePath: string, anchor: FileAnchor): Promise<void> {
  // EBUSY-wrapped: this runs inside the sign transaction on a box with live bots
  // touching the data tree, so it is the most likely transient-throw point. A
  // throw here correctly rolls the transaction back, but we retry first so a
  // foreign open-handle blip doesn't force the signer to re-sign.
  const tmp = `${anchorPath(filePath)}.tmp`;
  await withEbusyRetry(async () => {
    const fh = await fs.open(tmp, "w");
    try {
      await fh.writeFile(JSON.stringify(anchor, null, 2), "utf8");
      await fh.sync(); // RPO 0: the anchor is the real guarantee — durable before rename.
    } finally {
      await fh.close();
    }
    await fs.rename(tmp, anchorPath(filePath));
  });
}

export type AnchorVerdict =
  | { ok: true; secured: true } // hash matches AND HMAC matches (full seal)
  | { ok: true; secured: false; reason: string } // hash matches but no HMAC to check
  | { ok: false; reason: string }; // tampering detected or anchor missing

// Verify a signed file against its sidecar anchor. Reads both from disk.
export async function verifyFile(filePath: string): Promise<AnchorVerdict> {
  let anchorRaw: string;
  try {
    anchorRaw = await fs.readFile(anchorPath(filePath), "utf8");
  } catch {
    return { ok: false, reason: "anchor sidecar missing" };
  }
  let anchor: FileAnchor;
  try {
    anchor = JSON.parse(anchorRaw) as FileAnchor;
  } catch {
    return { ok: false, reason: "anchor sidecar unreadable" };
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch {
    return { ok: false, reason: "signed file missing" };
  }

  const actualHash = sha256(new Uint8Array(bytes));
  if (!hmacEquals(actualHash, anchor.sha256)) {
    return { ok: false, reason: "sha256 mismatch — file modified after sealing" };
  }

  const secret = getServerSecret();
  if (!anchor.hmac) {
    return { ok: true, secured: false, reason: "anchor has no HMAC (sealed without SERVER_SECRET)" };
  }
  if (!secret) {
    return { ok: true, secured: false, reason: "SERVER_SECRET unset — cannot verify HMAC" };
  }
  const expected = hmacSha256(anchor.sha256, secret);
  if (!hmacEquals(expected, anchor.hmac)) {
    return { ok: false, reason: "HMAC mismatch — anchor forged or wrong secret" };
  }
  return { ok: true, secured: true };
}
