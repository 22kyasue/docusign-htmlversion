import type { Contract, Signer } from "./contract-types";

// HTML escape — used on every interpolated field. The template uses tagged
// templates (`html\`...\``) which auto-escape. Bullet lists pass through the
// same escape per item.
function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      out += Array.isArray(v) ? v.join("") : esc(v);
    }
  });
  return out;
}

function fmtJpy(n: number): string {
  return n.toLocaleString("ja-JP");
}

function fmtDate(iso: string): string {
  // Render as YYYY年M月D日 (Japanese business convention).
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function listItems(items: string[]): string {
  return items.map((it) => html`<li>${it}</li>`).join("");
}

function signerBlock(s: Signer, contract: Contract): string {
  const v = contract.variables;
  const isStudio = s.role === "studio";
  const company = isStudio ? v.studioCompany : v.clientCompany;
  const legal = isStudio ? v.studioLegalName : v.clientLegalName;
  const address = isStudio ? v.studioAddress : v.clientAddress;
  const role = isStudio ? "甲（受託者）" : "乙（委託者）";
  const signed = s.signedAt
    ? html`<p class="signed">
        署名日時: ${fmtDate(s.signedAt)} <span class="mono">(${s.signedAt})</span>
      </p>`
    : html`<p class="unsigned">未署名</p>`;

  return html`
    <div class="signer-block ${s.signedAt ? "is-signed" : "is-pending"}">
      <h3>${role}</h3>
      <p class="company">${company}</p>
      ${legal ? html`<p class="legal">${legal}</p>` : ""}
      ${address ? html`<p class="address">${address}</p>` : ""}
      <p class="rep">代表者 ${s.name}</p>
      <p class="email mono">${s.email}</p>
      ${signed}
      <div class="signature-image" data-signer-id="${s.id}"></div>
    </div>
  `;
}

// Render the full contract body as an HTML fragment (no <html>/<body>; the
// page layout supplies those). Caller decides whether to wrap with the
// signing UI (token mode) or the read-only audit footer (completed mode).
export function renderContractBody(contract: Contract): string {
  const v = contract.variables;
  const tax = Math.round((v.priceJpy * v.taxRatePercent) / 100);
  const total = v.priceJpy + tax;

  return html`
    <article class="contract-body">
      <header class="contract-header">
        <h1>業務委託契約書</h1>
        <p class="subtitle">${v.projectName}</p>
        <p class="meta mono">契約 ID: ${contract.id}</p>
      </header>

      <p class="preamble">
        ${v.studioCompany}（以下「甲」という）と ${v.clientCompany}（以下「乙」という）は、
        甲が乙に対して提供する以下の業務について、本契約を締結する。
      </p>

      <section>
        <h2>第1条（業務内容）</h2>
        <p>甲は乙に対し、本契約に基づき以下の業務（以下「本件業務」という）を提供する。</p>
        <ul class="deliverables">${listItems(v.deliverables.map(esc))}</ul>
        <p>提供言語: ${esc(v.languagePairs.join(" / "))}</p>
        ${
          v.scopeNotes
            ? html`<p class="notes">補足: ${v.scopeNotes}</p>`
            : ""
        }
        ${
          v.outOfScopeNotes
            ? html`<p class="notes">対象外: ${v.outOfScopeNotes}</p>`
            : ""
        }
      </section>

      <section>
        <h2>第2条（契約金額及び支払）</h2>
        <table class="money">
          <tbody>
            <tr><th>契約金額（税抜）</th><td>¥${fmtJpy(v.priceJpy)}</td></tr>
            <tr><th>消費税（${v.taxRatePercent}%）</th><td>¥${fmtJpy(tax)}</td></tr>
            <tr class="total"><th>合計（税込）</th><td>¥${fmtJpy(total)}</td></tr>
          </tbody>
        </table>
        <p>支払条件: ${v.paymentSchedule}</p>
        <p>支払方法: ${v.paymentMethod}</p>
      </section>

      <section>
        <h2>第3条（スケジュール）</h2>
        <p>着手日: ${fmtDate(v.kickoffDate)}</p>
        <p>納品期限: ${fmtDate(v.deliveryDeadline)}</p>
        <p>修正対応: 納品後 ${v.revisionRounds} 回まで本契約に含まれる。</p>
      </section>

      <section>
        <h2>第4条（成果物の権利）</h2>
        <p>
          本件業務に係る成果物の著作権は、乙が契約金額の全額を支払った時点で、
          甲から乙に移転する。ただし、甲が制作のために使用した汎用的なテンプレート、
          コンポーネント、ライブラリ等の権利は甲に留保される。
        </p>
      </section>

      <section>
        <h2>第5条（秘密保持）</h2>
        <p>
          甲及び乙は、本契約の履行に関して相手方から知り得た一切の業務上、
          技術上の情報を、相手方の事前の書面による承諾なくして第三者に開示又は漏洩してはならない。
          本条の規定は、本契約終了後も3年間効力を有する。
        </p>
      </section>

      <section>
        <h2>第6条（解除）</h2>
        <p>
          甲又は乙は、相手方が本契約の各条項に違反し、相当の期間を定めて催告したにもかかわらず
          当該違反が是正されないときは、本契約を解除することができる。
        </p>
      </section>

      <section>
        <h2>第7条（準拠法及び合意管轄）</h2>
        <p>
          本契約は ${v.governingLaw} に準拠し、本契約に関する一切の紛争については、
          ${v.jurisdiction} を第一審の専属的合意管轄裁判所とする。
        </p>
      </section>

      <section class="signatures">
        <h2>署名</h2>
        <div class="signer-grid">
          ${contract.signers.map((s) => signerBlock(s, contract)).join("")}
        </div>
      </section>
    </article>
  `;
}

// CSS used on both the live page and the print view.
export const CONTRACT_CSS = `
.contract-body { font-family: "Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", system-ui, sans-serif; line-height: 1.75; color: #0a0a0a; }
.contract-body h1 { font-size: 1.85rem; font-weight: 600; letter-spacing: 0.04em; text-align: center; }
.contract-body .subtitle { text-align: center; color: #444; margin-top: 0.25rem; }
.contract-body .meta { text-align: center; color: #777; font-size: 0.75rem; margin-top: 0.25rem; }
.contract-body .preamble { margin: 2rem 0; }
.contract-body section { margin: 1.75rem 0; }
.contract-body h2 { font-size: 1.1rem; font-weight: 600; border-left: 3px solid #0a0a0a; padding-left: 0.6rem; margin-bottom: 0.6rem; }
.contract-body .deliverables { padding-left: 1.4rem; }
.contract-body table.money { border-collapse: collapse; margin: 0.5rem 0 0.75rem; }
.contract-body table.money th { text-align: left; padding: 0.25rem 1.5rem 0.25rem 0; font-weight: 500; color: #444; }
.contract-body table.money td { padding: 0.25rem 0; font-variant-numeric: tabular-nums; }
.contract-body table.money tr.total th, .contract-body table.money tr.total td { border-top: 1px solid #aaa; padding-top: 0.5rem; font-weight: 600; }
.contract-body .notes { color: #555; font-size: 0.9rem; }
.contract-body .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
.contract-body .signer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 1rem; }
.contract-body .signer-block { border: 1px solid #ddd; border-radius: 0.75rem; padding: 1rem; background: #fafafa; }
.contract-body .signer-block.is-signed { border-color: #059669; background: #f0fdf4; }
.contract-body .signer-block h3 { font-size: 0.8rem; font-weight: 600; color: #555; letter-spacing: 0.08em; text-transform: uppercase; }
.contract-body .signer-block .company { font-size: 1.05rem; font-weight: 600; margin-top: 0.4rem; }
.contract-body .signer-block .legal, .contract-body .signer-block .address { color: #555; font-size: 0.85rem; }
.contract-body .signer-block .rep { margin-top: 0.4rem; }
.contract-body .signer-block .email { color: #666; font-size: 0.75rem; }
.contract-body .signer-block .signed { color: #059669; font-size: 0.85rem; margin-top: 0.5rem; }
.contract-body .signer-block .unsigned { color: #b45309; font-size: 0.85rem; margin-top: 0.5rem; }
.contract-body .signer-block .signature-image { margin-top: 0.5rem; min-height: 50px; }
.contract-body .signer-block .signature-image img { max-width: 100%; max-height: 80px; }

@media (max-width: 640px) {
  .contract-body .signer-grid { grid-template-columns: 1fr; }
}

@media print {
  body { background: white !important; }
  .contract-body { color: black; }
  .contract-body .signer-block { background: white; border-color: #999; }
  .contract-body .signer-block.is-signed { background: white; border-color: #444; }
  .no-print { display: none !important; }
}
`;

// Inline a signature image into a snapshot HTML string. Used at the moment a
// signer commits — we re-render the contract body with the new signed-at on
// the signer, then patch the empty `.signature-image[data-signer-id="..."]`
// slot with the actual PNG data URL so the snapshot is self-contained.
export function injectSignatureImage(
  bodyHtml: string,
  signerId: string,
  pngDataUrl: string,
): string {
  const re = new RegExp(
    `(<div class="signature-image" data-signer-id="${signerId.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    )}">)(\\s*)(</div>)`,
  );
  return bodyHtml.replace(re, `$1<img alt="signature" src="${pngDataUrl}" />$3`);
}

// Produce a full standalone HTML document for the print view or for the
// completion snapshot stored on disk.
export function renderStandaloneHtml(contract: Contract, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(contract.variables.projectName)} – 契約書</title>
<style>
body { margin: 0; padding: 2rem 1.25rem; background: #f7f7f5; }
main { max-width: 780px; margin: 0 auto; background: white; padding: 2.5rem 2rem; border-radius: 1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
${CONTRACT_CSS}
@media print {
  body { padding: 0; background: white; }
  main { box-shadow: none; border-radius: 0; padding: 1.5rem; }
}
</style>
</head>
<body>
<main>${bodyHtml}</main>
</body>
</html>`;
}
