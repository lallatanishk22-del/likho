import type { BillData } from "../billData.js";
import {
  esc, rupees, has, summaryRows, businessLines, customerLines, logoImg, page, statusDetail,
} from "./shared.js";

// FORMAT 4 — RESTAURANT / FOOD
// For restaurants, tiffin services, home chefs, bakeries. The hierarchy is
// the ORDER, not the invoice: who it is for sits at the top in a band of
// its own, quantities are large and left-aligned as a kitchen would read
// them, and per-item instructions ("less spicy") are first-class rather
// than a footnote. Ends on a thank-you, because this bill is handed to a
// person who just ate your food.
const CSS = `
  body { font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color:#1c1917; }
  .head { text-align:center; padding-bottom:5mm; border-bottom:2px dashed #d6d3d1; }
  .biz-name { font-size:22pt; font-weight:800; letter-spacing:-.01em; margin:0 0 1.5mm; line-height:1.15; }
  .biz-line { font-size:9pt; color:#78716c; line-height:1.5; }
  .order { margin-top:5mm; background:#fff7ed; border:1px solid #fed7aa; border-radius:3mm;
           padding:4mm 5mm; display:flex; justify-content:space-between; align-items:center; gap:6mm; }
  .for-label { font-size:7.5pt; letter-spacing:.14em; text-transform:uppercase; color:#c2410c; }
  .for-name { font-size:14pt; font-weight:700; line-height:1.2; }
  .for-line { font-size:9pt; color:#78716c; }
  .order-meta { text-align:right; font-size:9pt; color:#78716c; line-height:1.5; white-space:nowrap; }
  .order-meta strong { display:block; font-size:12pt; color:#1c1917; }
  .items { margin-top:6mm; font-size:10.5pt; }
  .items td { padding:3.2mm 0; border-bottom:1px solid #f5f5f4; vertical-align:top; }
  .q { width:13mm; font-size:13pt; font-weight:800; color:#ea580c; font-variant-numeric:tabular-nums; }
  .rate { font-size:8.5pt; color:#a8a29e; margin-top:.6mm; }
  .instruction { font-size:8.5pt; color:#c2410c; margin-top:.8mm; font-style:italic; }
  .totals { margin-top:5mm; margin-left:auto; width:74mm; font-size:10.5pt; color:#57534e; }
  .totals td { padding:1.6mm 0; }
  .totals .total td { border-top:2px solid #1c1917; padding-top:3mm;
                      font-size:17pt; font-weight:800; color:#1c1917; }
  .pay { margin-top:5mm; padding:3.5mm 5mm; background:#fafaf9; border-radius:2mm;
         display:flex; justify-content:space-between; gap:8mm; font-size:9.5pt; color:#57534e; }
  .thanks { margin-top:7mm; text-align:center; font-size:11pt; font-weight:600; color:#c2410c; }
  .note { margin-top:3mm; text-align:center; font-size:9pt; color:#78716c; }
  .logo { margin:0 auto 3mm; }
`;

export function renderFood(data: BillData): string {
  const rows = summaryRows(data);
  const custLines = customerLines(data);
  const thanks = has(data.business.footerNote)
    ? String(data.business.footerNote)
    : "Thank you for your order!";

  const body = `
  <div class="head">
    ${logoImg(data, 46)}
    <h1 class="biz-name">${esc(data.business.name)}</h1>
    ${businessLines(data).map((l) => `<div class="biz-line">${esc(l)}</div>`).join("")}
  </div>

  <div class="order">
    <div>
      <div class="for-label">Order for</div>
      <div class="for-name">${custLines.length > 0 ? esc(custLines[0]) : "Walk-in"}</div>
      ${custLines.slice(1).map((l) => `<div class="for-line">${esc(l)}</div>`).join("")}
    </div>
    <div class="order-meta">
      <strong>#${esc(data.billNo)}</strong>
      ${esc(data.dateLabel)}${has(data.timeLabel) ? `<br />${esc(data.timeLabel)}` : ""}
    </div>
  </div>

  <table class="items">
    <tbody>
      ${data.items.map((line) => `<tr>
        <td class="q">${esc(line.quantity)}×</td>
        <td class="item-name">${esc(line.name)}
          <div class="rate">${rupees(line.unitPrice)} each</div>
          ${has(line.note) ? `<div class="instruction">${esc(line.note)}</div>` : ""}</td>
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
    <span>${esc(statusDetail(data))}</span>
    ${has(data.business.upiId) ? `<span>UPI: ${esc(data.business.upiId)}</span>` : ""}
  </div>

  ${has(data.notes) ? `<div class="note">${esc(data.notes)}</div>` : ""}
  <div class="thanks">${esc(thanks)}</div>`;

  return page({ title: `Order #${data.billNo} — ${data.business.name}`, css: CSS, body });
}
