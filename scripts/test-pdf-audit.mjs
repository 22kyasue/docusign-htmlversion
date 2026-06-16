// Regression tests for lib/pdf.ts appendAuditPage. Locks two bugs found in QA:
//   1. The overflow branch must reassign `page` so many audit entries land on a
//      real new page instead of drawing off the bottom of page 1.
//   2. A non-WinAnsi actor name (e.g. a Japanese signer 「林」) must NOT throw —
//      it is sanitized to ASCII on the cosmetic page; the real name lives in the
//      record + audit.log.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

const { appendAuditPage } = await import("../lib/pdf.ts");

// A minimal 1-page PDF to append onto.
async function basePdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  return new Uint8Array(await pdf.save());
}

test("Japanese actor name does not throw (winAnsiSafe)", async () => {
  const out = await appendAuditPage({
    pdfBytes: await basePdf(),
    documentId: "d1",
    documentName: "白壁荘-contract.pdf",
    originalSha256: "a".repeat(64),
    signedSha256: "b".repeat(64),
    entries: [{ at: "2026-01-01T00:00:00Z", action: "signed", actor: "林" }],
  });
  const pdf = await PDFDocument.load(out);
  assert.ok(pdf.getPageCount() >= 2); // base page + at least one audit page
});

test("many audit entries overflow onto additional pages without throwing", async () => {
  const entries = Array.from({ length: 120 }, (_, i) => ({
    at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
    action: "signed",
    actor: `Signer ${i}`,
    ip: "203.0.113.7",
    userAgent: "Mozilla/5.0 (regression-test) very long user agent string here",
  }));
  const base = await basePdf();
  const baseCount = (await PDFDocument.load(base)).getPageCount();
  const out = await appendAuditPage({
    pdfBytes: base,
    documentId: "d2",
    documentName: "long.pdf",
    originalSha256: "c".repeat(64),
    signedSha256: "d".repeat(64),
    entries,
  });
  const pdf = await PDFDocument.load(out);
  // 120 entries (each up to 2 lines) cannot fit on one page — overflow must have
  // added MORE than a single audit page.
  assert.ok(
    pdf.getPageCount() > baseCount + 1,
    `expected overflow onto multiple audit pages, got ${pdf.getPageCount()} (base ${baseCount})`,
  );
});
