// Validate that a byte buffer is a STRUCTURALLY COMPLETE PNG image, not merely
// a PNG-shaped header. This is the gate that stops a blank or non-renderable
// "signature" from being sealed into a legal contract.
//
// A header-only blob (the 8-byte signature + an IHDR declaring a size, with no
// pixel data) passes a naive magic/IHDR check yet renders blank in every
// browser. We therefore walk the chunk list and require:
//   - a valid IHDR (correct length + tag) with non-degenerate dimensions,
//   - at least one non-empty IDAT chunk (the actual compressed pixels),
//   - a terminating IEND chunk.

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// PNG layout offsets (bytes), measured from the start of the file:
const IHDR_LENGTH_OFFSET = 8; // first chunk's 4-byte length field
const IHDR_TAG_OFFSET = 12; // the literal "IHDR"
const IHDR_WIDTH_OFFSET = 16;
const IHDR_HEIGHT_OFFSET = 20;
const IHDR_DATA_LENGTH = 13; // IHDR payload is always 13 bytes
const CHUNK_FRAME_BYTES = 12; // 4 length + 4 type + 4 CRC, excluding data

// A 1x1 (or smaller) image is not a real hand-drawn signature.
const MIN_DIMENSION = 2;

// 8 sig + 4 len + 4 "IHDR" + 13 IHDR data + 4 crc = 33 bytes minimum.
const MIN_PNG_BYTES = 33;

function tagAt(bytes: Uint8Array, off: number): string {
  return String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
}

export function isValidPng(bytes: Uint8Array): boolean {
  if (bytes.length < MIN_PNG_BYTES) return false;
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) return false;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // First chunk after the signature must be a well-formed IHDR.
  if (view.getUint32(IHDR_LENGTH_OFFSET) !== IHDR_DATA_LENGTH) return false;
  if (tagAt(bytes, IHDR_TAG_OFFSET) !== "IHDR") return false;
  if (
    view.getUint32(IHDR_WIDTH_OFFSET) < MIN_DIMENSION ||
    view.getUint32(IHDR_HEIGHT_OFFSET) < MIN_DIMENSION
  ) {
    return false;
  }

  // Walk every chunk: [4-byte length][4-byte type][data][4-byte CRC].
  let offset = IHDR_LENGTH_OFFSET; // start at the IHDR length field
  let sawIdat = false;
  while (offset + CHUNK_FRAME_BYTES <= bytes.length) {
    const dataLen = view.getUint32(offset);
    const type = tagAt(bytes, offset + 4);
    const nextOffset = offset + CHUNK_FRAME_BYTES + dataLen;
    if (nextOffset > bytes.length) return false; // truncated chunk
    if (type === "IDAT" && dataLen > 0) sawIdat = true;
    if (type === "IEND") return sawIdat; // complete only if we saw pixel data
    offset = nextOffset;
  }
  return false; // no IEND → truncated/incomplete PNG
}
