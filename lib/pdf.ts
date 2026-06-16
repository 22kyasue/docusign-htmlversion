import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { SignatureField, AuditEntry } from "./types";

export type StampInput = {
  pdfBytes: Uint8Array;
  signaturePng: Uint8Array;
  fields: SignatureField[];
};

export async function stampSignature({ pdfBytes, signaturePng, fields }: StampInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes);
  const png = await pdf.embedPng(signaturePng);
  const pages = pdf.getPages();

  for (const f of fields) {
    if (f.page < 0 || f.page >= pages.length) continue;
    const page = pages[f.page];
    const { width: pw, height: ph } = page.getSize();
    const w = f.widthRatio * pw;
    const h = f.heightRatio * ph;
    const x = f.xRatio * pw;
    // ratios use top-left origin; pdf-lib uses bottom-left
    const y = ph - f.yRatio * ph - h;
    page.drawImage(png, { x, y, width: w, height: h });
  }

  return await pdf.save();
}

export type AuditPageInput = {
  pdfBytes: Uint8Array;
  documentId: string;
  documentName: string;
  originalSha256: string;
  signedSha256: string;
  entries: AuditEntry[];
};

export async function appendAuditPage(input: AuditPageInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input.pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage();
  const { height } = page.getSize();
  const margin = 50;
  let y = height - margin;

  const draw = (text: string, opts: { size?: number; bold?: boolean; gap?: number } = {}) => {
    const size = opts.size ?? 10;
    const f = opts.bold ? bold : font;
    page.drawText(text, { x: margin, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
    y -= (opts.gap ?? size + 4);
  };

  draw("Audit Trail", { size: 18, bold: true, gap: 28 });
  draw(`Document ID: ${input.documentId}`);
  draw(`Document Name: ${input.documentName}`);
  draw(`Original SHA-256: ${input.originalSha256}`);
  draw(`Signed   SHA-256: ${input.signedSha256}`);
  draw(`Generated: ${new Date().toISOString()}`);
  y -= 10;
  draw("Events", { size: 13, bold: true, gap: 18 });

  for (const e of input.entries) {
    if (y < margin + 40) {
      // start a new audit page if we run out
      const next = pdf.addPage();
      const sz = next.getSize();
      y = sz.height - margin;
    }
    draw(`${e.at}  ${e.action}${e.actor ? `  by ${e.actor}` : ""}`);
    if (e.ip || e.userAgent) {
      draw(`   ip=${e.ip ?? "-"}  ua=${(e.userAgent ?? "-").slice(0, 80)}`, { size: 8 });
    }
  }

  return await pdf.save();
}
