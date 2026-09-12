import type { StoredBill } from "./billStore.js";
import type { Reply, ReplyAction } from "./reply.js";
import { formatBusinessDateTime } from "./businessDay.js";
import { escapeHtml } from "./billText.js";

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

// The bill as an ARTIFACT, not a paragraph: aligned columns, a real
// transaction number, and an explicit payment state. Rendered from STORED
// state so the seller always sees exactly what is persisted.
export function renderStoredBill(stored: StoredBill): string {
  const { session, items } = stored;

  const rows = items.map((item) => ({
    left: `${titleCase(item.name_snapshot)} \u00d7 ${item.quantity}`,
    right: formatRupees(Number(item.line_total)),
  }));

  const summary: { left: string; right: string }[] = [];
  if (Number(session.discount_percent) > 0) {
    summary.push({ left: "Subtotal", right: formatRupees(Number(session.subtotal)) });
    summary.push({
      left: `Discount (${Number(session.discount_percent)}%)`,
      right: `\u2212${formatRupees(Number(session.discount_amount))}`,
    });
  }
  summary.push({ left: "TOTAL", right: formatRupees(Number(session.total)) });

  // Money is RIGHT-aligned: the amounts must end in one column so they can
  // be compared by eye. Left-padding the label only made them all START at
  // the same place, which lines up nothing — Rs 45 and Rs 560 still ended
  // four characters apart.
  const all = [...rows, ...summary];
  const labelW = Math.max(...all.map((r) => r.left.length));
  const amountW = Math.max(...all.map((r) => r.right.length));
  const width = labelW + 3 + amountW;
  const line = (r: { left: string; right: string }) =>
    r.left.padEnd(labelW + 3) + r.right.padStart(amountW);

  const who = session.customer_ref ? `${titleCase(session.customer_ref)} \u2014 ` : "";
  const paid =
    session.payment_status === "paid"
      ? "Paid"
      : session.payment_status === "partial"
        ? `Partly paid \u2014 ${formatRupees(Number(session.amount_paid))} of ${formatRupees(Number(session.total))}`
        : "Pending";

  // Every bill carries its own date and time, in the business's timezone.
  // A bill without one is a message, not a record — and once several exist
  // in a chat, "which day was this?" has no answer without it.
  const stamp = formatBusinessDateTime(new Date(session.finalized_at ?? session.created_at));

  return [
    `\u{1f9fe} ${who}Bill #${session.bill_no}`,
    stamp,
    "",
    ...rows.map(line),
    "\u2500".repeat(width),
    ...summary.map(line),
    "",
    `Payment: ${paid}`,
  ].join("\n");
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
    actions.push({ label: "\u{1f4b0} Mark Paid", action: `paid:${no}` });
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
