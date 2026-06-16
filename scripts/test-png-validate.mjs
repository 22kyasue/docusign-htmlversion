// Regression tests for lib/png-validate.ts — the gate that stops a blank or
// structurally-incomplete "signature" from being sealed into a legal contract.
// Pure Node, no test framework. Run: `npm test`.
//
// The headline case is the exact 24-byte header-only payload that slipped past
// an earlier magic/IHDR-only check (Sovereign Sign QA, 2026-06): it must be
// rejected. If anyone weakens isValidPng back to a header check, this fails.

import assert from "node:assert/strict";
import zlib from "node:zlib";
import { isValidPng } from "../lib/png-validate.ts";

function b(base64) {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

// Build a real, decodable WxH PNG (IHDR + IDAT + IEND) for the positive case.
function realPng(w, h) {
  const crc32 = (buf) => {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const t = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = [];
  for (let y = 0; y < h; y++) {
    raw.push(0); // filter byte
    for (let x = 0; x < w; x++) {
      const ink = x === y ? 0 : 255;
      raw.push(ink, ink, ink, 255);
    }
  }
  const idat = zlib.deflateSync(Buffer.from(raw));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", idat),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const cases = [
  // [name, bytes, expected]
  ["empty buffer", new Uint8Array(0), false],
  ["prefix/empty data url decode", b(""), false],
  [
    "header-only exploit (24 bytes: magic + 1x1 IHDR, no IDAT/IEND)",
    b("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"),
    false,
  ],
  [
    "1x1 real PNG (decodable but degenerate signature)",
    b("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
    false,
  ],
  ["non-PNG (JPEG magic mislabeled)", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), false],
  ["real 8x8 PNG with IDAT + IEND", realPng(8, 8), true],
  ["real 64x32 PNG", realPng(64, 32), true],
];

let failed = 0;
for (const [name, bytes, expected] of cases) {
  try {
    assert.equal(isValidPng(bytes), expected);
    console.log(`  ok    ${name}`);
  } catch {
    failed++;
    console.error(`  FAIL  ${name} — expected ${expected}, got ${!expected}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} PNG-validation test(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} PNG-validation tests passed.`);
