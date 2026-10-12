import type { Ledger, LedgerStatus } from "../ledger.js";
import { esc, page } from "./shared.js";
import { formatBusinessDate, formatBusinessDateTime } from "../businessDay.js";

// The ledger as a printable sheet: gridlines, a shaded header row, figures
// right-aligned in their own columns and a totals row — the shape a seller
// knows from Excel or a khata book. Fixed template; nothing generated.

const CSS = `
  body { font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color:#111; font-size:9.5pt; }
  .head { display:flex; justify-content:space-between; align-items:flex-end;
          border-bottom:2px solid #111; padding-bottom:4mm; }
  .shop { font-size:16pt; font-weight:700; }
  .title { text-align:right; }
  .title b { font-size:12pt; letter-spacing:.14em; text-transform:uppercase; display:block; }
  .title span { font-size:9.5pt; color:#555; }
  .cards { display:flex; gap:3mm; margin:5mm 0 4mm; }
  .card { flex:1; border:1px solid #bbb; padding:3mm 4mm; }
  .card.due { border:2px solid #111; }
  .card small { display:block; font-size:7.5pt; letter-spacing:.12em; text-transform:uppercase; color:#666; }
  .card strong { font-size:15pt; }
  .meta { font-size:8.5pt; color:#555; margin-bottom:2mm; }
  table.sheet { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
  .sheet th, .sheet td { border:1px solid #bbb; padding:1.6mm 2mm; }
  .sheet th { background:#e9edf2; font-size:8pt; text-transform:uppercase; letter-spacing:.06em; text-align:left; }
  .sheet tbody tr:nth-child(even) td { background:#f7f8fa; }
  .num { text-align:right; white-space:nowrap; }
  .sheet tfoot td { font-weight:700; border-top:2.5px double #111; background:#fff; }
  .Paid { color:#137333; } .Part { color:#a15c00; } .Unpaid { color:#b3261e; }
  .draft { color:#888; font-size:7.5pt; }
  .foot { margin-top:4mm; font-size:7.5pt; color:#777; display:flex; justify-content:space-between; }
`;

const money = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const statusClass = (s: LedgerStatus) => (s === "Part paid" ? "Part" : s);

export function renderLedger(ledger: Ledger, shopName: string | null, customer: string | null): string {
  const title = customer ? `Ledger — ${customer}` : "Sales ledger";
  const rows = ledger.rows
    .map(
      (r, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td>${esc(formatBusinessDate(r.date))}</td>
        <td>#${r.billNo}</td>
        ${customer ? "" : `<td>${esc(r.customer ? r.customer.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : "—")}</td>`}
        <td class="num">${money(r.billed)}</td>
        <td class="num">${money(r.received)}</td>
        <td class="num">${money(r.due)}</td>
        <td><span class="${statusClass(r.status)}">${r.status}</span>${r.confirmed ? "" : ` <span class="draft">· draft</span>`}</td>
      </tr>`,
    )
    .join("");

  const body = `
    <div class="head">
      <div class="shop">${esc(shopName ?? "")}</div>
      <div class="title"><b>${esc(title)}</b><span>${esc(ledger.label)}</span></div>
    </div>
    <div class="cards">
      <div class="card"><small>Billed</small><strong>₹${money(ledger.billed)}</strong></div>
      <div class="card"><small>Received</small><strong>₹${money(ledger.received)}</strong></div>
      <div class="card due"><small>Due</small><strong>₹${money(ledger.due)}</strong></div>
    </div>
    <div class="meta">${ledger.rows.length} bill(s)${
      ledger.unconfirmedCount > 0 ? ` · ${ledger.unconfirmedCount} not confirmed yet (marked “draft”)` : ""
    }</div>
    <table class="sheet">
      <thead><tr>
        <th>#</th><th>Date</th><th>Bill</th>${customer ? "" : "<th>Customer</th>"}
        <th class="num">Billed ₹</th><th class="num">Received ₹</th><th class="num">Due ₹</th><th>Status</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="${customer ? 3 : 4}">Total</td>
        <td class="num">${money(ledger.billed)}</td>
        <td class="num">${money(ledger.received)}</td>
        <td class="num">${money(ledger.due)}</td>
        <td></td>
      </tr></tfoot>
    </table>
    <div class="foot">
      <span>Billed = Received + Due · “draft” = not confirmed yet</span>
      <span>Likho · ${esc(formatBusinessDateTime(new Date()))}</span>
    </div>`;

  return page({ title: `${title} · ${ledger.label}`, css: CSS, body });
}
