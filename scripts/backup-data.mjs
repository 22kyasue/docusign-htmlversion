// Encrypted snapshot of ./data — the signed PDFs, anchors, metadata DB, and
// append-only audit log ARE the product; back them up.
//
// Mechanism: tar the data/ tree in memory, encrypt with AES-256-GCM under a key
// derived (scrypt) from BACKUP_PASSPHRASE, write a single self-describing
// .enc file. Decrypt with `node scripts/backup-data.mjs --restore <file> <dir>`.
//
// HONEST SCOPE: this produces a LOCAL encrypted snapshot. Shipping it OFF-BOX
// (the only thing that actually defends against disk loss / a disk attacker /
// whole-record deletion — see lib/anchor.ts) is a documented TODO pending the
// Hetzner deploy; this machine has no deploy/SSH access. Wire the off-box push
// (rsync to a backup host / append-only object storage) where marked below.
//
// Usage:
//   BACKUP_PASSPHRASE=... node scripts/backup-data.mjs            # snapshot
//   BACKUP_PASSPHRASE=... node scripts/backup-data.mjs --restore <file.enc> <outDir>

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MAGIC = Buffer.from("SSBKP1\n"); // Sovereign Sign BacKuP v1
const DATA_DIR = path.join(process.cwd(), "data");
const OUT_DIR = path.join(process.cwd(), "backups");

function deriveKey(passphrase, salt) {
  return scryptSync(passphrase, salt, 32);
}

// Build a deterministic archive of data/ without shelling to tar (cross-platform
// + Windows). Format: repeated [4-byte pathLen][path][8-byte dataLen][data].
async function pack(dir) {
  const chunks = [];
  async function walk(rel) {
    const abs = path.join(dir, rel);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(childRel);
      } else if (e.isFile()) {
        const data = await fs.readFile(path.join(dir, childRel));
        const pathBuf = Buffer.from(childRel, "utf8");
        const head = Buffer.alloc(12);
        head.writeUInt32BE(pathBuf.length, 0);
        head.writeBigUInt64BE(BigInt(data.length), 4);
        chunks.push(head, pathBuf, data);
      }
    }
  }
  await walk("");
  return Buffer.concat(chunks);
}

async function unpack(buf, outDir) {
  let off = 0;
  while (off < buf.length) {
    // Layout written by pack(): [pathLen u32][dataLen u64][path bytes][data].
    const pathLen = buf.readUInt32BE(off);
    const dataLen = Number(buf.readBigUInt64BE(off + 4));
    off += 12;
    const rel = buf.subarray(off, off + pathLen).toString("utf8");
    off += pathLen;
    const data = buf.subarray(off, off + dataLen);
    off += dataLen;
    const dest = path.join(outDir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, data);
  }
}

async function snapshot(passphrase) {
  await fs.access(DATA_DIR).catch(() => {
    throw new Error(`no data dir at ${DATA_DIR}`);
  });
  const plain = await pack(DATA_DIR);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  // file = MAGIC | salt(16) | iv(12) | tag(16) | ciphertext
  const out = Buffer.concat([MAGIC, salt, iv, tag, enc]);

  await fs.mkdir(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(OUT_DIR, `data-${stamp}.enc`);
  await fs.writeFile(file, out);
  console.log(`snapshot written: ${file} (${out.length} bytes, ${plain.length} plaintext)`);

  // TODO (Hetzner deploy): push `file` off-box, append-only, e.g.
  //   spawnSync("rsync", ["-a", file, "backup@host:/srv/ss-backups/"], {...})
  // or upload to versioned/object-locked storage. No deploy access on this
  // machine yet — local snapshot only. This is the documented gap.
  void spawnSync;
  return file;
}

async function restore(passphrase, file, outDir) {
  const buf = await fs.readFile(file);
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("not a Sovereign Sign backup (bad magic)");
  }
  let off = MAGIC.length;
  const salt = buf.subarray(off, off + 16);
  off += 16;
  const iv = buf.subarray(off, off + 12);
  off += 12;
  const tag = buf.subarray(off, off + 16);
  off += 16;
  const enc = buf.subarray(off);
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]); // throws on wrong key/tamper
  await fs.mkdir(outDir, { recursive: true });
  await unpack(plain, outDir);
  console.log(`restored ${plain.length} bytes into ${outDir}`);
}

async function main() {
  const passphrase = process.env.BACKUP_PASSPHRASE;
  if (!passphrase || passphrase.length < 8) {
    console.error("set BACKUP_PASSPHRASE (>= 8 chars)");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  if (args[0] === "--restore") {
    if (!args[1] || !args[2]) {
      console.error("usage: --restore <file.enc> <outDir>");
      process.exit(1);
    }
    await restore(passphrase, args[1], args[2]);
  } else {
    await snapshot(passphrase);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
