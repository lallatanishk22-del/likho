import type { StatementData } from "../statementData.js";
import { esc, rupees, has, businessLines, logoImg, page } from "./shared.js";

// The statement document. Visually a sibling of the Classic bill — this is
// a record to be trusted and filed, not a piece of branding, so it stays
// plain and dense: one row per bill, the outstanding figure impossible to
// miss, and a period stated at the top so the page cannot be misread as
// covering all time when it does not.
const CSS = `
  body { font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color:#111; font-size:10pt; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; gap:10mm;
          border-bottom:2px solid #111; padding-bottom:5mm; }
  .biz-name { font-size:17pt; font-weight:700; margin:0 0 1.5mm; line-height:1.2; }
  .biz-line { font-size:9pt; color:#555; line-height:1.5; }
  .doc { text-align:right; white-space:nowrap; }
  .doc-title { font-size:13pt; font-weight:700; letter-spacing:.16em; text-transform:uppercase; }
  .doc-line { font-size:9pt; color:#555; line-height:1.6; margin-top:1.5mm; }
  .who { margin:6mm 0 2mm; }
  .who-label { font-size:7.5pt; letter-spacing:.14em; text-transform:uppercase; color:#777; }
  .who-name { font-size:15pt; font-weight:700; line-height:1.2; }
  .period { font-size:9.5pt; color:#555; margin-top:1mm; }
  .cards { display:flex; gap:4mm; margin:5mm 0 2mm; }
  .card { flex:1; border:1px solid #ddd; border-radius:2mm; padding:3.5mm 4mm; }
  .card.due { border-color:#111; border-width:2px; }
  .card-label { font-size:7.5pt; letter-spacing:.12em; text-transform:uppercase; color:#777; }
  .card-value { font-size:15pt; font-weight:700; margin-top:1mm; }
  table.rows { margin-top:4mm; font-size:9.5pt; }
  table.rows th { text-align:left; font-size:7.5pt; letter-spacing:.12em; text-transform:uppercase;
                  border-bottom:1.5px solid #111; padding:0 2.5mm 2mm 0; }
  table.rows td { padding:2.4mm 2.5mm 2.4mm 0; border-bottom:1px solid #e6e6e6; vertical-align:top; }
  table.rows th:last-child, table.rows td:last-child { padding-right:0; }
  .items { font-size:8pt; color:#777; margin-top:.6mm; }
  .tag { font-size:7.5pt; letter-spacing:.08em; text-transform:uppercase; white-space:nowrap; }
  .tag.unpaid { color:#b91c1c; font-weight:700; }
  .tag.partial { color:#b45309; font-weight:700; }
  .tag.paid { color:#555; }
  .tag.draft { color:#999; }
  tfoot td { padding-top:3mm; border-top:2px solid #111; font-weight:700; font-size:11.5pt; }
  .drafts { margin-top:4mm; padding:3mm 4mm; background:#f6f6f6; border-left:3px solid #999;
            font-size:9pt; color:#444; line-height:1.5; }
  .foot { margin-top:6mm; padding-top:3mm; border-top:1px solid #ddd;
          display:flex; justify-content:space-between; gap:8mm; font-size:8.5pt; color:#666; }
  .logo { margin-bottom:3mm; }
`;

export function renderStatement(data: StatementData): string {
  const body = `
  <div class="head">
    <div>
      ${logoImg(data, 40)}
      <h1 class="biz-name">${esc(data.business.name)}</h1>
      ${businessLines(data).map((l) => `<div class="biz-line">${esc(l)}</div>`).join("")}
    </div>
    <div class="doc">
      <div class="doc-title">Statement</div>
      <div class="doc-line">Generated ${esc(data.generatedLabel)}</div>
    </div>
  </div>

  <div class="who">
    <div class="who-label">Account</div>
    <div class="who-name">${esc(data.customerName)}</div>
    <div class="period">${esc(data.periodLabel)} · ${data.billCount} confirmed bill${data.billCount === 1 ? "" : "s"}${
      data.draftCount > 0 ? ` · ${data.draftCount} draft${data.draftCount === 1 ? "" : "s"}` : ""
    }</div>
  </div>

  <div class="cards">
    <div class="card">
      <div class="card-label">Billed</div><div class="card-value">${rupees(data.grandTotal)}</div>
    </div>
    <div class="card">
      <div class="card-label">Received</div><div class="card-value">${rupees(data.paidTotal)}</div>
    </div>
    <div class="card due">
      <div class="card-label">Outstanding</div><div class="card-value">${rupees(data.outstanding)}</div>
    </div>
  </div>

  <table class="rows">
    <thead><tr>
      <th>Bill</th><th>Date</th><th>Items</th>
      <th class="num">Amount</th><th class="num">Paid</th><th>Status</th>
    </tr></thead>
    <tbody>
      ${data.lines.map((line) => `<tr>
        <td>#${esc(line.billNo)}</td>
        <td>${esc(line.dateLabel)}<div class="items">${esc(line.timeLabel)}</div></td>
        <td class="item-name">${esc(line.itemSummary)}</td>
        <td class="num">${rupees(line.total)}</td>
        <td class="num">${rupees(line.amountPaid)}</td>
        <td><span class="tag ${!line.confirmed ? "draft" : line.paymentStatus === "paid" ? "paid" : line.paymentStatus}">${
          !line.confirmed ? "Draft" : line.paymentStatus === "paid" ? "Paid" : line.paymentStatus === "partial" ? "Part paid" : "Unpaid"
        }</span></td>
      </tr>`).join("")}
    </tbody>
    <tfoot><tr>
      <td colspan="3">Total</td>
      <td class="num">${rupees(data.grandTotal)}</td>
      <td class="num">${rupees(data.paidTotal)}</td>
      <td></td>
    </tr></tfoot>
  </table>

  ${data.draftCount > 0 ? `<div class="drafts">
    ${data.draftCount} draft${data.draftCount === 1 ? "" : "s"} worth ${rupees(data.draftTotal)}
    ${data.draftCount === 1 ? "is" : "are"} listed below but not counted above \u2014
    a draft is not a transaction until it is confirmed.
  </div>` : ""}

  <div class="foot">
    <span>${data.draftCount > 0 ? "Drafts are shown but not counted in the totals above." : "Every bill above is confirmed."}</span>
    ${has(data.business.upiId) ? `<span>UPI: ${esc(data.business.upiId)}</span>` : ""}
  </div>`;

  return page({ title: `Statement — ${data.customerName}`, css: CSS, body });
}
