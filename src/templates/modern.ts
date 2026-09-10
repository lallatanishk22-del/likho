import type { BillData } from "../billData.js";
import {
  esc, rupees, qty, has, summaryRows, businessLines, customerLines, logoImg, page, statusLabel, statusDetail,
} from "./shared.js";

// FORMAT 2 — MODERN
// For cafes, cloud kitchens, boutiques. Different HIERARCHY, not just
// different colours: the total is lifted out of the summary column into a
// full-width band, so the first thing the eye lands on is the amount. Items
// lose their table rules and become airy rows. Generous whitespace is the
// point — this bill is meant to feel considered.
const CSS = `
  body { font-family: ui-sans-serif, -apple-system, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
         color:#0f172a; }
  .head { display:flex; justify-content:space-between; align-items:flex-start; gap:10mm; }
  .biz-name { font-size:20pt; font-weight:700; letter-spacing:-.02em; margin:0 0 1.5mm; line-height:1.15; }
  .biz-line { font-size:9pt; color:#64748b; line-height:1.55; }
  .chip { display:inline-block; padding:1.6mm 3.4mm; border-radius:999px; font-size:7.5pt;
          font-weight:700; letter-spacing:.1em; text-transform:uppercase; }
  .chip.paid { background:#dcfce7; color:#166534; }
  .chip.partial { background:#fef3c7; color:#92400e; }
  .chip.pending { background:#f1f5f9; color:#475569; }
  .meta { text-align:right; font-size:9pt; color:#64748b; line-height:1.6; white-space:nowrap; }
  .meta .no { display:block; font-size:12pt; font-weight:700; color:#0f172a; margin:2mm 0 1mm; }
  .card { margin-top:8mm; background:#f8fafc; border-radius:4mm; padding:5mm 6mm; }
  .card-label { font-size:7.5pt; letter-spacing:.14em; text-transform:uppercase; color:#94a3b8; margin-bottom:1.5mm; }
  .card-name { font-size:12pt; font-weight:600; }
  .items { margin-top:8mm; font-size:10pt; }
  .items th { text-align:left; font-size:7.5pt; letter-spacing:.14em; text-transform:uppercase;
              color:#94a3b8; font-weight:600; padding-bottom:3mm; }
  .items td { padding:3.4mm 0; border-top:1px solid #f1f5f9; }
  .items tbody tr:first-child td { border-top:1px solid #e2e8f0; }
  .items th.num, .items td.num { padding-left:6mm; }
  .rate { font-size:8.5pt; color:#94a3b8; }
  .totals { margin-top:5mm; margin-left:auto; width:74mm; font-size:10pt; color:#475569; }
  .totals td { padding:1.5mm 0; }
  .grand { margin-top:6mm; background:#0f172a; color:#fff; border-radius:4mm;
           padding:5mm 6mm; display:flex; justify-content:space-between; align-items:center; }
  .grand-label { font-size:8pt; letter-spacing:.16em; text-transform:uppercase; opacity:.7; }
  .grand-value { font-size:20pt; font-weight:700; letter-spacing:-.02em; }
  .foot { margin-top:6mm; display:flex; justify-content:space-between; gap:8mm;
          font-size:9pt; color:#64748b; }
  .note { margin-top:4mm; font-size:9pt; color:#64748b; }
  .logo { margin-bottom:3mm; }
`;

export function renderModern(data: BillData): string {
  const rows = summaryRows(data).filter((r) => r.kind !== "total");
  const custLines = customerLines(data);

  const body = `
  <div class="head">
    <div>
      ${logoImg(data, 40)}
      <h1 class="biz-name">${esc(data.business.name)}</h1>
      ${businessLines(data).map((l) => `<div class="biz-line">${esc(l)}</div>`).join("")}
    </div>
    <div class="meta">
      <span class="chip ${data.paymentStatus}">${esc(statusLabel(data))}</span>
      <span class="no">#${esc(data.billNo)}</span>
      ${esc(data.dateLabel)}${has(data.timeLabel) ? ` · ${esc(data.timeLabel)}` : ""}
    </div>
  </div>

  ${custLines.length > 0 ? `
  <div class="card">
    <div class="card-label">Billed to</div>
    <div class="card-name">${esc(custLines[0])}</div>
    ${custLines.slice(1).map((l) => `<div class="biz-line">${esc(l)}</div>`).join("")}
  </div>` : ""}

  <table class="items">
    <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead>
    <tbody>
      ${data.items.map((line) => `<tr>
        <td class="item-name">${esc(line.name)}
          <div class="rate">${rupees(line.unitPrice)} each${has(line.note) ? ` · ${esc(line.note)}` : ""}</div></td>
        <td class="num">${esc(qty(line))}</td>
        <td class="num">${rupees(line.lineTotal)}</td>
      </tr>`).join("")}
    </tbody>
  </table>

  ${rows.length > 0 ? `<table class="totals">
    ${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${esc(r.value)}</td></tr>`).join("")}
  </table>` : ""}

  <div class="grand totals">
    <span class="grand-label">Total</span>
    <span class="grand-value">${rupees(data.total)}</span>
  </div>

  <div class="foot">
    <div>${esc(statusDetail(data))}</div>
    ${has(data.business.upiId) ? `<div>UPI · ${esc(data.business.upiId)}</div>` : ""}
  </div>
  ${has(data.notes) ? `<div class="note">${esc(data.notes)}</div>` : ""}
  ${has(data.business.footerNote) ? `<div class="note">${esc(data.business.footerNote)}</div>` : ""}`;

  return page({ title: `Bill #${data.billNo} — ${data.business.name}`, css: CSS, body });
}
