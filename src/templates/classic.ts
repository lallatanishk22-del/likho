import type { BillData } from "../billData.js";
import {
  esc, rupees, qty, has, summaryRows, businessLines, customerLines, logoImg, page, statusDetail,
} from "./shared.js";

// FORMAT 1 — CLASSIC
// The safe default. Black on white, ruled table, no colour doing any work.
// Hierarchy: business name -> bill meta -> items -> total. Nothing competes
// with the total. This is the one that has to look right for a shop that
// has told Likho nothing but its own name.
const CSS = `
  body { font-family: "Times New Roman", Georgia, serif; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; gap:12mm;
          border-bottom:2px solid #111; padding-bottom:5mm; }
  .biz-name { font-size:23pt; font-weight:700; letter-spacing:.01em; line-height:1.15; margin:0 0 2mm; }
  .biz-line { font-size:9.5pt; color:#333; line-height:1.5; }
  .meta { text-align:right; font-size:9.5pt; line-height:1.6; white-space:nowrap; }
  .meta .no { font-size:14pt; font-weight:700; display:block; margin-bottom:1mm; }
  .to { margin:6mm 0 0; font-size:10pt; }
  .to-label { font-size:8pt; letter-spacing:.14em; text-transform:uppercase; color:#666; margin-bottom:1.5mm; }
  .to-name { font-size:12.5pt; font-weight:700; }
  .items { margin-top:8mm; font-size:10pt; }
  .items th { text-align:left; font-size:8pt; letter-spacing:.12em; text-transform:uppercase;
              border-bottom:1px solid #111; padding:0 0 2mm; font-weight:700; }
  .items td { padding:2.6mm 0; border-bottom:1px solid #e0e0e0; }
  .items th.num, .items td.num { padding-left:6mm; }
  .totals { margin-top:5mm; margin-left:auto; width:78mm; font-size:10.5pt; }
  .totals tr td { padding:1.6mm 0; }
  .totals .deduction { color:#444; }
  .totals .total td { border-top:2px solid #111; padding-top:3mm; font-size:15pt; font-weight:700; }
  .pay { margin-top:7mm; padding-top:4mm; border-top:1px solid #ddd;
         display:flex; justify-content:space-between; gap:8mm; font-size:9.5pt; }
  .note { margin-top:5mm; font-size:9pt; color:#555; font-style:italic; }
  .logo { display:block; margin-bottom:3mm; }
`;

export function renderClassic(data: BillData): string {
  const bizLines = businessLines(data);
  const custLines = customerLines(data);
  const rows = summaryRows(data);

  const body = `
  <div class="head">
    <div>
      ${logoImg(data, 46)}
      <h1 class="biz-name">${esc(data.business.name)}</h1>
      ${bizLines.map((l) => `<div class="biz-line">${esc(l)}</div>`).join("")}
    </div>
    <div class="meta">
      <span class="no">Bill #${esc(data.billNo)}</span>
      ${esc(data.dateLabel)}
      ${has(data.timeLabel) ? `<br />${esc(data.timeLabel)}` : ""}
      ${has(data.dueDateLabel) ? `<br />Due ${esc(data.dueDateLabel)}` : ""}
    </div>
  </div>

  ${custLines.length > 0 ? `
  <div class="to">
    <div class="to-label">Billed to</div>
    <div class="to-name">${esc(custLines[0])}</div>
    ${custLines.slice(1).map((l) => `<div class="biz-line">${esc(l)}</div>`).join("")}
  </div>` : ""}

  <table class="items">
    <thead><tr>
      <th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th>
    </tr></thead>
    <tbody>
      ${data.items.map((line) => `<tr>
        <td class="item-name">${esc(line.name)}${has(line.note) ? `<br /><span class="biz-line">${esc(line.note)}</span>` : ""}</td>
        <td class="num">${esc(qty(line))}</td>
        <td class="num">${rupees(line.unitPrice)}</td>
        <td class="num">${rupees(line.lineTotal)}</td>
      </tr>`).join("")}
    </tbody>
  </table>

  <table class="totals">
    ${rows.map((r) => `<tr class="${r.kind}">
      <td>${esc(r.label)}</td><td class="num">${esc(r.value)}</td>
    </tr>`).join("")}
  </table>

  <div class="pay">
    <div>${esc(statusDetail(data))}</div>
    ${has(data.business.upiId) ? `<div>UPI: ${esc(data.business.upiId)}</div>` : ""}
  </div>
  ${has(data.notes) ? `<div class="note">${esc(data.notes)}</div>` : ""}
  ${has(data.business.footerNote) ? `<div class="note">${esc(data.business.footerNote)}</div>` : ""}`;

  return page({ title: `Bill #${data.billNo} — ${data.business.name}`, css: CSS, body });
}
