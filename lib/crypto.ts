import { createHash } from "node:crypto";

export function sha256(bytes: Uint8Array | Buffer): string {
  const h = createHash("sha256");
  h.update(bytes);
  return h.digest("hex");
}
