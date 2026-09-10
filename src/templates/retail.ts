import type { BillData } from "../billData.js";
import {
  esc, rupees, amount, has, summaryRows, businessLines, customerLines, page, statusDetail,
} from "./shared.js";

// FORMAT 3 — RETAIL / POS
// Built for MANY line items, not for looking pretty with three. Different
// hierarchy again: the item table dominates the page, rows are dense and
// zebra-striped for scanning down a column, and a serial number column
// lets a shopkeeper and a customer point at the same row. Product code
// prints under the name when one exists. Everything above the table is
// compressed to a single band so more rows fit on page one.
const CSS = `
  body { font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color:#111; }
  .bar { border:1.5px solid #111; padding:4mm 5mm; display:flex;
         justify-content:space-between; align-items:center; gap:8mm; }
  .biz-name { font-size:16pt; font-weight:800; letter-spacing:-.01em; margin:0; line-height:1.15; }
  .biz-line { font-size:8.5pt; color:#444; line-height:1.45; }
  .meta { text-align:right; font-size:8.5pt; line-height:1.5; white-space:nowrap; }
  .meta strong { font-size:11pt; }
  .strip { display:flex; justify-content:space-between; gap:8mm;
           font-size:8.5pt; padding:2.5mm 5mm; background:#f4f4f5; border:1px solid #d4d4d8; border-top:0; }
  .items { font-size:9.5pt; margin-top:0; }
  .items th { background:#111; color:#fff; text-align:left; font-size:7.5pt;
              letter-spacing:.1em; text-transform:uppercase; padding:2.4mm 2.5mm; font-weight:700; }
  .items td { padding:2.1mm 2.5mm; border-bottom:1px solid #e4e4e7; }
  .items tbody tr:nth-child(even) td { background:#fafafa; }
  .sn { width:9mm; color:#71717a; font-variant-numeric:tabular-nums; }
  .code { font-size:7.5pt; color:#71717a; letter-spacing:.04em; }
  .totals { margin-top:4mm; margin-left:auto; width:76mm; font-size:10pt; }
  .totals td { padding:1.4mm 2.5mm; }
  .totals tr.normal td, .totals tr.deduction td { border-bottom:1px solid #e4e4e7; }
  .totals .total td { background:#111; color:#fff; font-size:13.5pt; font-weight:800; padding:3mm 2.5mm; }
  .count { margin-top:4mm; font-size:9pt; color:#52525b;
           display:flex; justify-content:space-between; gap:8mm; }
  .note { margin-top:4mm; font-size:8.5pt; color:#52525b; }
`;

export function renderRetail(data: BillData): string {
  const rows = summaryRows(data);
  const custLines = customerLines(data);
  const units = data.items.reduce((sum, l) => sum + l.quantity, 0);

  const body = `
  <div class="bar">
    <div>
      <h1 class="biz-name">${esc(data.business.name)}</h1>
      ${businessLines(data).map((l) => `<div class="biz-line">${esc(l)}</div>`).join("")}
    </div>
    <div class="meta">
      <strong>BILL #${esc(data.billNo)}</strong><br />
      ${esc(data.dateLabel)}${has(data.timeLabel) ? `<br />${esc(data.timeLabel)}` : ""}
    </div>
  </div>
  <div class="strip">
    <span>${custLines.length > 0 ? `Customer: ${esc(custLines.join(" · "))}` : "Counter sale"}</span>
    <span>${esc(statusDetail(data))}</span>
  </div>

  <table class="items">
    <thead><tr>
      <th class="sn">#</th><th>Item</th>
      <th class="num">Qty</th><th class="num">Rate (₹)</th><th class="num">Amount (₹)</th>
    </tr></thead>
    <tbody>
      ${data.items.map((line, i) => `<tr>
        <td class="sn">${i + 1}</td>
        <td class="item-name">${esc(line.name)}${has(line.code) ? `<div class="code">${esc(line.code)}</div>` : ""}</td>
        <td class="num">${esc(line.quantity)}${has(line.unit) ? ` ${esc(line.unit)}` : ""}</td>
        <td class="num">${amount(line.unitPrice)}</td>
        <td class="num">${amount(line.lineTotal)}</td>
      </tr>`).join("")}
    </tbody>
  </table>

  <table class="totals">
    ${rows.map((r) => `<tr class="${r.kind}">
      <td>${esc(r.label)}</td><td class="num">${esc(r.value)}</td>
    </tr>`).join("")}
  </table>

  <div class="count">
    <span>${data.items.length} item${data.items.length === 1 ? "" : "s"} · ${units} unit${units === 1 ? "" : "s"}</span>
    ${has(data.business.upiId) ? `<span>UPI: ${esc(data.business.upiId)}</span>` : ""}
  </div>
  ${has(data.notes) ? `<div class="note">${esc(data.notes)}</div>` : ""}
  ${has(data.business.footerNote) ? `<div class="note">${esc(data.business.footerNote)}</div>` : ""}`;

  return page({ title: `Bill #${data.billNo} — ${data.business.name}`, css: CSS, body });
}
