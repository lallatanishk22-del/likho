import type { BillData } from "./billData.js";
import { rupees, summaryRows, has, statusDetail } from "./templates/shared.js";

// The bill as it appears IN THE CHAT — the version a seller actually looks
// at every day, and the one they forward to a customer. The PDF is the
// formal artifact; this is the working one.
//
// The problem this file solves: the old renderer padded columns with
// spaces, but the message was sent with no parse_mode, so Telegram drew it
// in a proportional font where "M" is wider than "i". The padding was
// computed and then thrown away, and the money column came out ragged.
// A monospace block is what makes a text table an actual table.

// Telegram wraps a <pre> block at roughly 30-34 characters on a phone
// before it starts scrolling sideways. Staying inside that keeps the bill
// readable without a horizontal drag.
const WIDTH = 30;

// With parse_mode set, an unescaped "<" or "&" in a product name either
// breaks the message or is silently swallowed. Same discipline as the PDF
// templates.
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Fits a label into the space left over once the amount is placed, so a
// long product name can never push the money off the line.
function fit(label: string, amountText: string, width = WIDTH): string {
  const room = width - amountText.length - 1;
  const shown = label.length > room ? `${label.slice(0, Math.max(1, room - 1))}…` : label;
  return shown.padEnd(room) + " " + amountText.padStart(amountText.length);
}

function row(label: string, amountText: string, width = WIDTH): string {
  const room = Math.max(1, width - amountText.length);
  const shown = label.length > room - 1 ? `${label.slice(0, room - 2)}…` : label;
  return shown.padEnd(room) + amountText;
}

function heading(data: BillData): string[] {
  const who = has(data.customer?.name) ? `${data.customer!.name} — ` : "";
  const lines = [`🧾 ${who}Bill #${data.billNo}`];
  const when = [data.dateLabel, data.timeLabel].filter(has).join(", ");
  if (when) lines.push(when);
  return lines;
}

export type TextStyle = "plain" | "table" | "slip";

// STYLE A — plain. What Likho sends today: no alignment guarantee, because
// nothing tells Telegram to use a fixed-width font.
function renderPlain(data: BillData): string {
  const lines = heading(data);
  lines.push("");
  for (const item of data.items) {
    lines.push(`${item.name} × ${item.quantity} — ${rupees(item.lineTotal)}`);
  }
  lines.push("");
  for (const r of summaryRows(data)) {
    lines.push(`${r.kind === "total" ? r.label.toUpperCase() : r.label} — ${r.value}`);
  }
  lines.push("", `Payment: ${statusDetail(data)}`);
  return lines.join("\n");
}

// STYLE B — table. Monospace, one line per item, money right-aligned in a
// true column. The quantity rides under the name so a long product name
// never fights the amount for space.
function renderTable(data: BillData): string {
  const body: string[] = [];
  for (const item of data.items) {
    body.push(row(item.name, rupees(item.lineTotal)));
    body.push(`  ${item.quantity} × ${rupees(item.unitPrice)}`);
  }
  body.push("─".repeat(WIDTH));
  for (const r of summaryRows(data)) {
    body.push(row(r.kind === "total" ? r.label.toUpperCase() : r.label, r.value));
  }
  return [...heading(data), "", ...body, "", `Payment: ${statusDetail(data)}`].join("\n");
}

// STYLE C — slip. Compact: quantity, name and amount on ONE line, the way
// a printed receipt reads. Fits more items on a phone screen without
// scrolling, at the cost of hiding the unit price.
function renderSlip(data: BillData): string {
  const body: string[] = [];
  for (const item of data.items) {
    body.push(row(`${item.quantity}× ${item.name}`, rupees(item.lineTotal)));
  }
  body.push("─".repeat(WIDTH));
  for (const r of summaryRows(data)) {
    body.push(row(r.kind === "total" ? r.label.toUpperCase() : r.label, r.value));
  }
  return [...heading(data), "", ...body, "", statusDetail(data)].join("\n");
}

export function renderBillText(data: BillData, style: TextStyle): string {
  if (style === "plain") return renderPlain(data);
  if (style === "slip") return renderSlip(data);
  return renderTable(data);
}

// Styles B and C only mean anything inside a monospace block.
export function needsMonospace(style: TextStyle): boolean {
  return style !== "plain";
}

export function asTelegramHtml(text: string): string {
  return `<pre>${escapeHtml(text)}</pre>`;
}

export const TEXT_STYLES: { id: TextStyle; name: string; note: string }[] = [
  { id: "plain", name: "Plain", note: "what you get today — no column alignment" },
  { id: "table", name: "Table", note: "aligned columns, unit price under each item" },
  { id: "slip", name: "Slip", note: "one line per item, most compact" },
];
