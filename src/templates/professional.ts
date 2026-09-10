import type { BillData } from "../billData.js";
import {
  esc, rupees, amount, qty, has, summaryRows, businessLines, customerLines, logoImg, page, statusLabel,
} from "./shared.js";

// FORMAT 5 — PROFESSIONAL INVOICE
// For freelancers, agencies, B2B. The hierarchy here is the DOCUMENT: the
// word INVOICE and its number lead, From and Bill To sit as parallel
// blocks the way a business expects, and the amount due gets its own boxed
// panel with the due date beside it. This is the only template that leads
// with what is owed rather than what was bought, and the only one with a
// terms section.
const CSS = `
  body { font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color:#1e293b; font-size:10pt; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; gap:10mm;
          padding-bottom:6mm; border-bottom:3px solid #1e3a8a; }
  .title { font-size:26pt; font-weight:300; letter-spacing:.22em; color:#1e3a8a;
           text-transform:uppercase; margin:0; line-height:1; }
  .title-no { font-size:10pt; color:#64748b; letter-spacing:.06em; margin-top:2.5mm; }
  .biz { text-align:right; }
  .biz-name { font-size:13pt; font-weight:700; margin:0 0 1.5mm; line-height:1.2; }
  .biz-line { font-size:9pt; color:#64748b; line-height:1.5; }
  .parties { display:flex; gap:10mm; margin-top:7mm; }
  .party { flex:1; }
  .party-label { font-size:7.5pt; letter-spacing:.14em; text-transform:uppercase;
                 color:#94a3b8; margin-bottom:2mm; }
  .party-name { font-size:11pt; font-weight:600; margin-bottom:1mm; }
  .dates { margin-left:auto; text-align:right; font-size:9pt; line-height:1.9; white-space:nowrap; }
  .dates dt { color:#94a3b8; display:inline; }
  .dates dd { display:inline; margin:0 0 0 3mm; font-weight:600; }
  .items { margin-top:8mm; }
  .items th { text-align:left; font-size:7.5pt; letter-spacing:.12em; text-transform:uppercase;
              color:#475569; border-bottom:2px solid #cbd5e1; padding:0 2.5mm 2.5mm 0; font-weight:700; }
  .items td { padding:3mm 2.5mm 3mm 0; border-bottom:1px solid #e2e8f0; }
  .items th:last-child, .items td:last-child { padding-right:0; }
  .desc { font-size:8.5pt; color:#64748b; margin-top:.8mm; }
  .foot { display:flex; gap:10mm; margin-top:6mm; align-items:flex-start; }
  .terms { flex:1; font-size:8.5pt; color:#64748b; line-height:1.6; }
  .terms-label { font-size:7.5pt; letter-spacing:.14em; text-transform:uppercase;
                 color:#94a3b8; margin-bottom:1.5mm; }
  .sums { width:76mm; }
  .sums table { width:100%; font-size:9.5pt; }
  .sums td { padding:1.5mm 0; color:#475569; }
  .due { margin-top:3mm; background:#1e3a8a; color:#fff; padding:4mm 5mm; border-radius:2mm; }
  .due-label { font-size:7.5pt; letter-spacing:.14em; text-transform:uppercase; opacity:.75; }
  .due-value { font-size:18pt; font-weight:700; margin-top:1mm; }
  .due-status { font-size:8pt; opacity:.75; margin-top:1mm; letter-spacing:.06em; }
  .logo { margin-bottom:3mm; margin-left:auto; }
`;

export function renderProfessional(data: BillData): string {
  const rows = summaryRows(data).filter((r) => r.kind !== "total");
  const custLines = customerLines(data);

  const body = `
  <div class="head">
    <div>
      <h1 class="title">Invoice</h1>
      <div class="title-no">#${esc(data.billNo)}</div>
    </div>
    <div class="biz">
      ${logoImg(data, 38)}
      <div class="biz-name">${esc(data.business.name)}</div>
      ${businessLines(data).map((l) => `<div class="biz-line">${esc(l)}</div>`).join("")}
    </div>
  </div>

  <div class="parties">
    ${custLines.length > 0 ? `<div class="party">
      <div class="party-label">Bill to</div>
      <div class="party-name">${esc(custLines[0])}</div>
      ${custLines.slice(1).map((l) => `<div class="biz-line">${esc(l)}</div>`).join("")}
    </div>` : ""}
    <dl class="dates">
      <div><dt>Issued</dt><dd>${esc(data.dateLabel)}</dd></div>
      ${has(data.dueDateLabel) ? `<div><br /><dt>Due</dt><dd>${esc(data.dueDateLabel)}</dd></div>` : ""}
    </dl>
  </div>

  <table class="items">
    <thead><tr>
      <th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th>
    </tr></thead>
    <tbody>
      ${data.items.map((line) => `<tr>
        <td class="item-name">${esc(line.name)}${has(line.note) ? `<div class="desc">${esc(line.note)}</div>` : ""}</td>
        <td class="num">${esc(qty(line))}</td>
        <td class="num">${amount(line.unitPrice)}</td>
        <td class="num">${amount(line.lineTotal)}</td>
      </tr>`).join("")}
    </tbody>
  </table>

  <div class="foot">
    <div class="terms">
      ${has(data.business.upiId) || has(data.paymentMethod) ? `
        <div class="terms-label">Payment</div>
        ${has(data.business.upiId) ? `<div>UPI: ${esc(data.business.upiId)}</div>` : ""}
        ${has(data.paymentMethod) ? `<div>Method: ${esc(data.paymentMethod)}</div>` : ""}` : ""}
      ${has(data.notes) ? `<div class="terms-label" style="margin-top:4mm">Notes</div><div>${esc(data.notes)}</div>` : ""}
      ${has(data.business.footerNote) ? `<div style="margin-top:3mm">${esc(data.business.footerNote)}</div>` : ""}
    </div>
    <div class="sums totals">
      ${rows.length > 0 ? `<table>${rows.map((r) => `<tr>
        <td>${esc(r.label)}</td><td class="num">${esc(r.value)}</td>
      </tr>`).join("")}</table>` : ""}
      <div class="due">
        <div class="due-label">${data.paymentStatus === "paid" ? "Amount paid" : "Amount due"}</div>
        <div class="due-value">${rupees(data.paymentStatus === "paid" ? data.total : data.total - data.amountPaid)}</div>
        <div class="due-status">${esc(statusLabel(data))}${data.paymentStatus === "partial" ? ` · ${rupees(data.total)} total` : ""}</div>
      </div>
    </div>
  </div>`;

  return page({ title: `Invoice #${data.billNo} — ${data.business.name}`, css: CSS, body });
}
