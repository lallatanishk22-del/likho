import type { BillData } from "../billData.js";
import {
  esc, rupees, has, summaryRows, businessLines, customerLines, page, statusDetail,
} from "./shared.js";

// FORMAT 6 — MINIMAL RECEIPT
// 80mm thermal width, monospace, centred. The hierarchy is deliberately
// almost flat: this is a slip, not a document. Everything optional is
// dropped, the name and total are the only things emphasised, and it fits
// on a phone screen without zooming — which is how most of these are
// actually read.
const CSS = `
  body { font-family: "SF Mono", ui-monospace, Menlo, Consolas, "Courier New", monospace;
         color:#000; font-size:9pt; line-height:1.5; }
  .c { text-align:center; }
  .biz-name { font-size:13pt; font-weight:700; letter-spacing:.06em;
              text-transform:uppercase; margin:0 0 1.5mm; line-height:1.2; word-break:break-word; }
  .biz-line { font-size:8pt; color:#333; }
  .rule { border-top:1px dashed #000; margin:3mm 0; }
  .meta { display:flex; justify-content:space-between; font-size:8pt; gap:4mm; }
  .items { font-size:9pt; }
  .items td { padding:1.4mm 0; vertical-align:top; }
  .qxr { font-size:7.5pt; color:#444; }
  .totals { font-size:9pt; }
  .totals td { padding:.9mm 0; }
  .totals .total td { border-top:1px solid #000; border-bottom:3px double #000;
                      padding:2mm 0; font-size:12.5pt; font-weight:700; }
  .pay { margin-top:3mm; font-size:8.5pt; }
  .foot { margin-top:4mm; font-size:7.5pt; color:#444; }
`;

export function renderReceipt(data: BillData): string {
  const rows = summaryRows(data);
  const custLines = customerLines(data);

  const body = `
  <div class="c">
    <h1 class="biz-name">${esc(data.business.name)}</h1>
    ${businessLines(data).map((l) => `<div class="biz-line">${esc(l)}</div>`).join("")}
  </div>
  <div class="rule"></div>

  <div class="meta"><span>#${esc(data.billNo)}</span><span>${esc(data.dateLabel)}</span></div>
  ${has(data.timeLabel) || custLines.length > 0 ? `<div class="meta">
    <span>${custLines.length > 0 ? esc(custLines[0]) : ""}</span>
    <span>${has(data.timeLabel) ? esc(data.timeLabel) : ""}</span>
  </div>` : ""}
  <div class="rule"></div>

  <table class="items">
    <tbody>
      ${data.items.map((line) => `<tr>
        <td class="item-name">${esc(line.name)}
          <div class="qxr">${esc(line.quantity)} × ${rupees(line.unitPrice)}</div></td>
        <td class="num">${rupees(line.lineTotal)}</td>
      </tr>`).join("")}
    </tbody>
  </table>
  <div class="rule"></div>

  <table class="totals">
    ${rows.map((r) => `<tr class="${r.kind}">
      <td>${esc(r.label)}</td><td class="num">${esc(r.value)}</td>
    </tr>`).join("")}
  </table>

  <div class="pay c">${esc(statusDetail(data))}</div>
  ${has(data.business.upiId) ? `<div class="pay c">UPI: ${esc(data.business.upiId)}</div>` : ""}
  ${has(data.notes) ? `<div class="foot c">${esc(data.notes)}</div>` : ""}
  <div class="foot c">${esc(has(data.business.footerNote) ? data.business.footerNote : "Thank you!")}</div>`;

  return page({ title: `Receipt #${data.billNo}`, css: CSS, body, narrow: true });
}
