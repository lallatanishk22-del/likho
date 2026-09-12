import type { BillBusiness, BillData, BillLineView } from "../billData.js";

// Helpers every template shares. Nothing here computes money — money
// arrives already calculated and these functions only turn it into text.

// Bill data contains seller- and customer-supplied strings. They are
// interpolated into HTML that becomes a PDF, so every one is escaped.
export function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Indian digit grouping (1,00,000 not 100,000). Whole rupees stay clean;
// any paise component always shows two digits, as money should.
export function rupees(amount: number): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "₹0";
  const hasPaise = Math.round(n * 100) % 100 !== 0;
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

// Same, without the symbol, for table columns that carry their own header.
export function amount(value: number): string {
  return rupees(value).slice(1);
}

export function qty(line: BillLineView): string {
  return line.unit ? `${line.quantity} ${line.unit}` : String(line.quantity);
}

// A field is shown only when it actually has content. This is what keeps a
// bill from a business that gave nothing but its name looking unfinished —
// there are no empty labels, no blank GST block, no ghost logo box.
export function has(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim().length !== 0;
}

export function statusLabel(data: BillData): string {
  if (data.paymentStatus === "paid") return "PAID";
  if (data.paymentStatus === "partial") return "PART PAID";
  return "UNPAID";
}

export function statusDetail(data: BillData): string {
  if (data.paymentStatus === "paid") {
    return has(data.paymentMethod) ? `Paid via ${data.paymentMethod}` : "Paid in full";
  }
  if (data.paymentStatus === "partial") {
    return `${rupees(data.amountPaid)} paid · ${rupees(data.total - data.amountPaid)} due`;
  }
  return "Payment pending";
}

// Rows below the item table, in the order every template shows them.
// Centralised so six templates cannot disagree about whether a zero
// discount is displayed — it is not — or about ordering.
export interface SummaryRow {
  label: string;
  value: string;
  kind: "normal" | "deduction" | "total";
}

export function summaryRows(data: BillData): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const hasDeductions = data.discountAmount > 0 || data.taxes.length > 0;

  // With nothing between subtotal and total the two are the same number,
  // and printing it twice makes a bill look wrong.
  if (hasDeductions) {
    rows.push({ label: "Subtotal", value: rupees(data.subtotal), kind: "normal" });
  }
  if (data.discountAmount > 0) {
    const label = data.discountPercent > 0 ? `Discount (${data.discountPercent}%)` : "Discount";
    rows.push({ label, value: `−${rupees(data.discountAmount)}`, kind: "deduction" });
  }
  for (const tax of data.taxes) {
    const label = has(tax.rate) ? `${tax.label} ${tax.rate}%` : tax.label;
    rows.push({ label, value: rupees(tax.amount), kind: "normal" });
  }
  rows.push({ label: "Total", value: rupees(data.total), kind: "total" });
  return rows;
}

// Business identity lines, minus anything not provided.
export function businessLines(data: { business: BillBusiness }): string[] {
  const b = data.business;
  return [b.address, b.phone, has(b.gstin) ? `GSTIN: ${b.gstin}` : null]
    .filter(has)
    .map((v) => String(v));
}

export function customerLines(data: BillData): string[] {
  const c = data.customer;
  if (!c) return [];
  return [c.name, c.phone, c.address].filter(has).map((v) => String(v));
}

// Rendered only when a logo URL exists. No placeholder, no empty box — a
// bill without a logo should look deliberate, not broken.
export function logoImg(data: { business: BillBusiness }, size: number): string {
  if (!has(data.business.logoUrl)) return "";
  return `<img class="logo" src="${esc(data.business.logoUrl)}" alt="" style="max-height:${size}px;max-width:${size * 3}px" />`;
}

// Print/PDF foundations shared by all six templates.
//
// The rules that keep a browser-pretty design from breaking as a PDF:
//   - a fixed page box in mm, so the layout does not depend on viewport
//   - table headers repeat across pages, and a row never splits in half
//   - long product names wrap instead of stretching the table
//   - the totals block stays with the rows above it where it can
export const BASE_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: #fff;
    color: #111;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    padding: 14mm 14mm 16mm;
    background: #fff;
  }
  .page.narrow { width: 80mm; min-height: auto; padding: 8mm 6mm 10mm; }

  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  .items td, .items th { vertical-align: top; }

  /* Long names wrap; money columns never do. */
  .item-name { word-break: break-word; overflow-wrap: anywhere; hyphens: auto; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .totals { page-break-inside: avoid; break-inside: avoid; }

  @page { size: A4; margin: 0; }
  @media print { .page { margin: 0; box-shadow: none; } }

  @media screen {
    body { background: #eef1f5; padding: 24px 12px; }
    .page { box-shadow: 0 2px 18px rgba(16,24,40,.12); border-radius: 6px; }
  }
`;

// Wraps a template's body in a complete, self-contained document.
// Fonts are system stacks: a PDF renderer that has to fetch a webfont can
// silently produce a bill in the wrong typeface, or none at all.
export function page(opts: {
  title: string;
  css: string;
  body: string;
  narrow?: boolean;
}): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(opts.title)}</title>
<style>${BASE_CSS}${opts.css}</style>
</head><body>
<div class="page${opts.narrow ? " narrow" : ""}">${opts.body}</div>
</body></html>`;
}
