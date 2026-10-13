import type { StoredBill } from "./billStore.js";
import type { Reply, ReplyAction } from "./reply.js";
import { formatBusinessDateTime } from "./businessDay.js";
import { escapeHtml } from "./billText.js";
import { CATEGORY_LABEL } from "./orderNotes.js";

// How a bill and a history list LOOK in the chat.
//
// Separated from routing because they change for different reasons: the
// router changes when Likho learns a new instruction, this changes when a
// column is misaligned. Keeping both in one file meant every layout tweak
// touched the file that decides what happens to money.
//
// Everything here is presentation. No figure is computed — they arrive
// already calculated and are copied onto the line.

export function formatRupees(amount: number): string {
  const n = Number(amount);
  const hasPaise = Math.round(n * 100) % 100 !== 0;
  return `\u20b9${n.toLocaleString("en-IN", {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function titleCase(name: string): string {
  return name.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// The bill as a RECEIPT: what a printed shop slip looks like, in a
// monospace block. Item / Qty / Amount in real columns, the total between
// double rules, payment on its own line. Rendered from STORED state so the
// seller always sees exactly what is persisted.
//
// 24 characters wide. 30 wrapped every line on a phone with larger text
// (about 28 fit), which broke the whole receipt. Columns size themselves
// to the widest amount and quantity, so a ₹1,00,00,000 line or a quantity
// of 1,00,000 shrinks the name column instead of breaking the layout.
export const RECEIPT_WIDTH = 24;

export interface ReceiptInput {
  billNo: number;
  customer: string | null;
  stamp: string;
  items: { name: string; qty: number; amount: string }[];
  summary: { left: string; right: string }[];
  total: string;
  payment: string;
}

export function layoutReceipt(r: ReceiptInput): string[] {
  const W = RECEIPT_WIDTH;
  // Centred when it fits; a longer line is left as is rather than cut,
  // because it may carry money.
  const center = (s: string) => (s.length >= W ? s : " ".repeat(Math.floor((W - s.length) / 2)) + s);
  const clip = (s: string, room: number) => (s.length > room ? `${s.slice(0, Math.max(1, room - 1))}…` : s);
  const lr = (left: string, right: string) => {
    const room = W - right.length - 1;
    return clip(left, room).padEnd(W - right.length) + right;
  };

  const amountW = Math.max("Amount".length, ...r.items.map((i) => i.amount.length));
  const qtyW = Math.max("Qty".length, ...r.items.map((i) => String(i.qty).length));
  const nameW = W - amountW - qtyW - 2;
  const cols = (name: string, qty: string, amount: string) =>
    clip(name, nameW).padEnd(nameW) + " " + qty.padStart(qtyW) + " " + amount.padStart(amountW);

  const heading = r.customer ? `Bill #${r.billNo} · ${r.customer}` : `Bill #${r.billNo}`;
  return [
    center(heading),
    center(r.stamp),
    "-".repeat(W),
    cols("Item", "Qty", "Amount"),
    ...r.items.map((i) => cols(i.name, String(i.qty), i.amount)),
    ...(r.summary.length > 0 ? ["-".repeat(W), ...r.summary.map((s) => lr(s.left, s.right))] : []),
    "=".repeat(W),
    lr("TOTAL", r.total),
    "=".repeat(W),
    center(r.payment),
  ];
}

export function renderStoredBill(stored: StoredBill): string {
  const { session, items } = stored;

  const summary: { left: string; right: string }[] = [];
  if (Number(session.discount_percent) > 0) {
    summary.push({ left: "Subtotal", right: formatRupees(Number(session.subtotal)) });
    summary.push({
      left: `Discount ${Number(session.discount_percent)}%`,
      right: `−${formatRupees(Number(session.discount_amount))}`,
    });
  }
  for (const charge of Array.isArray(session.charges) ? session.charges : []) {
    summary.push({ left: charge.label, right: formatRupees(Number(charge.amount)) });
  }

  const total = Number(session.total);
  const paidSoFar = Number(session.amount_paid);
  const method = session.payment_method ? ` · ${session.payment_method}` : "";
  const payment =
    session.payment_status === "paid"
      ? `Paid in full${method}`
      : session.payment_status === "partial"
        ? `Paid ${formatRupees(paidSoFar)} · Due ${formatRupees(Math.round((total - paidSoFar) * 100) / 100)}${method}`
        : `Payment pending${method}`;

  // Every bill carries its own date and time, in the business's timezone.
  // A bill without one is a message, not a record — and once several exist
  // in a chat, "which day was this?" has no answer without it.
  const stamp = formatBusinessDateTime(new Date(session.finalized_at ?? session.created_at));

  const lines = layoutReceipt({
    billNo: session.bill_no,
    customer: session.customer_ref ? titleCase(session.customer_ref) : null,
    stamp,
    items: items.map((item) => ({
      name: titleCase(item.name_snapshot),
      qty: item.quantity,
      amount: formatRupees(Number(item.line_total)),
    })),
    summary,
    total: formatRupees(total),
    payment,
  });

  // INSTRUCTIONS GET THEIR OWN SPACE ON THE DOCUMENT.
  //
  // "less spicy" used to be thrown away between the order message and the
  // kitchen, leaving the seller to remember it themselves — which is the
  // exact work Likho exists to remove. Grouped by heading, below the
  // total, so the money table above is never disturbed by prose.
  const notes = Array.isArray(session.notes) ? session.notes : [];
  if (notes.length > 0) {
    const byCategory = new Map<string, string[]>();
    for (const n of notes) {
      const label = CATEGORY_LABEL[n.category] ?? CATEGORY_LABEL.note;
      byCategory.set(label, [...(byCategory.get(label) ?? []), n.text]);
    }
    lines.push("", "-".repeat(RECEIPT_WIDTH), "NOTES");
    for (const [label, texts] of byCategory) {
      lines.push(`${label}: ${texts.join("; ")}`);
    }
  }

  return lines.join("\n");
}

// Every reply that shows a bill goes through here.
//
// The bill is wrapped in <pre> so Telegram draws it in a FIXED-WIDTH font.
// The columns were always computed — padEnd has been in renderStoredBill
// from the start — but the message was sent with no parse_mode, so
// Telegram drew it proportionally and threw the padding away. "M" is wider
// than "i", so the money column came out ragged no matter what.
//
// A note ("Added chai x 2.") stays OUTSIDE the block: prose in a monospace
// font is harder to read, and only the table needs the alignment.
export function billReply(stored: StoredBill, note?: string): Reply {
  const body = `<pre>${escapeHtml(renderStoredBill(stored))}</pre>`;
  return {
    text: note ? `${escapeHtml(note)}\n${body}` : body,
    parseMode: "HTML" as const,
    actions: billActions(stored),
  };
}

// Actions offered alongside a bill. A draft's primary action is Confirm;
// once confirmed the useful actions are payment and PDF.
export function billActions(stored: StoredBill): ReplyAction[] {
  const no = stored.session.bill_no;
  const actions: ReplyAction[] = [];
  if (stored.session.status !== "finalized") {
    actions.push({ label: "\u2705 Confirm", action: `confirm:${no}` });
  }
  if (stored.session.payment_status !== "paid") {
    actions.push({ label: "\u{1f4b0} Paid", action: `paid:${no}` });
  }
  actions.push({ label: "\u{1f4c4} PDF", action: `pdf:${no}` });
  return actions;
}

// One bill, as one line, in columns.
//
// It used to take TWO lines per bill with nothing aligned, so a list of
// five bills was ten ragged rows and the amounts could not be compared by
// eye. Money is right-aligned in a fixed column and the year is dropped —
// inside a stated period it is the same on every row and only steals width.
export interface HistoryRow {
  no: string;
  when: string;
  amount: string;
  mark: string;
}

export function historyRow(bill: {
  bill_no: number; total: string | number; amount_paid: string | number;
  payment_status: string; status: string; created_at: string; finalized_at: string | null;
}): HistoryRow {
  const at = new Date(bill.finalized_at ?? bill.created_at);
  // "10 Sep" — the year is carried by the heading, not repeated per row.
  const when = new Intl.DateTimeFormat("en-IN", {
    timeZone: process.env["LIKHO_TIMEZONE"] ?? "Asia/Kolkata",
    day: "numeric", month: "short",
  }).format(at);

  const due = Number(bill.total) - Number(bill.amount_paid);
  const mark =
    bill.status !== "finalized" ? "draft"
    : bill.payment_status === "paid" ? "paid"
    : bill.payment_status === "partial" ? `${formatRupees(due)} due`
    : "unpaid";

  return { no: `#${bill.bill_no}`, when, amount: formatRupees(Number(bill.total)), mark };
}

// Lays rows out as a monospace block. Telegram draws <pre> in a fixed-width
// font, which is the only way spaces become a real column — padding a
// proportional font does nothing, which is why the old list stayed ragged
// however much it was padded.
//
// The summary is laid out by this SAME function, so the totals sit in the
// same money column as the bills above them instead of drifting.
export function alignedBlock(
  rows: { left: string; amount: string; right?: string }[],
): { lines: string[]; width: number } {
  const leftW = Math.max(...rows.map((r) => r.left.length));
  const amtW = Math.max(...rows.map((r) => r.amount.length));
  const lines = rows.map((r) => {
    const core = `${r.left.padEnd(leftW)}  ${r.amount.padStart(amtW)}`;
    return r.right ? `${core}  ${r.right}` : core;
  });
  return { lines, width: Math.max(...lines.map((l) => l.length)) };
}
