import type { SignatureField } from "./types";

// Pre-placed 甲（委託者）signature field for the Shirakabesō 業務委託契約書.
//
// Measured empirically by rendering the real PDF (612x792 US-Letter, 5 pages)
// and overlaying candidate boxes until the box sat inside the
// 「甲（委託者）… 署 名：____」 line on page 4 (page index 3), matching where the
// already-executed 乙 signature (岡田 晄太朗) sits in the right column.
//
// Ratios are top-left-origin (the convention lib/pdf.ts stampSignature expects).
export const SHIRAKABESO_KOU_FIELD: SignatureField = {
  page: 3,
  xRatio: 0.16,
  yRatio: 0.148,
  widthRatio: 0.285,
  heightRatio: 0.05,
};
