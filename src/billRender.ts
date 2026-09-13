import type { StoredBill } from "./billStore.js";
import type { BillNote } from "./types.js";
import { CATEGORY_LABEL } from "./orderNotes.js";
import type { BillData, BillBusiness } from "./billData.js";
import { formatBusinessDate, formatBusinessDateTime } from "./businessDay.js";

// Maps STORED bill state onto the presentation view model.
//
// Every money figure is COPIED from the stored row. calculator.ts computed
// it, billStore.ts persisted it, and this function moves it across
// unchanged. There is deliberately no arithmetic here beyond Number()
// parsing of Postgres numerics — a bill is a record of what was charged,
// not something to be recomputed at display time.

export interface BusinessProfile extends BillBusiness {
  id: string;
  billTemplate: string;
}

// Product names are stored lowercase so lookups are case-insensitive. That
// is a storage decision and it must not reach a customer's bill — "paneer
// roll x 2" reads as a database row, not as something you were served.
// Presentation only; the stored snapshot is untouched.
function displayName(name: string): string {
  return name.replace(/\b[\p{Ll}]/gu, (c) => c.toUpperCase());
}

function timeOnly(iso: string): string {
  const full = formatBusinessDateTime(new Date(iso));
  const parts = full.split(", ");
  return parts.length > 1 ? parts.slice(1).join(", ") : full;
}

// "Prep: less spicy; no onion · Timing: deliver by 8pm"
export function renderNotesLine(notes: BillNote[]): string | null {
  if (notes.length === 0) return null;
  const byCategory = new Map<string, string[]>();
  for (const n of notes) {
    const label = CATEGORY_LABEL[n.category] ?? CATEGORY_LABEL.note;
    byCategory.set(label, [...(byCategory.get(label) ?? []), n.text]);
  }
  return [...byCategory.entries()]
    .map(([label, texts]) => `${label}: ${texts.join("; ")}`)
    .join("  \u00b7  ");
}

export function toBillData(stored: StoredBill, business: BusinessProfile): BillData {
  const { session, items } = stored;
  const stamp = session.finalized_at ?? session.created_at;

  return {
    business: {
      name: business.name,
      phone: business.phone ?? null,
      address: business.address ?? null,
      gstin: business.gstin ?? null,
      upiId: business.upiId ?? null,
      logoUrl: business.logoUrl ?? null,
      footerNote: business.footerNote ?? null,
    },
    customer: session.customer_ref ? { name: displayName(session.customer_ref) } : null,
    billNo: session.bill_no,
    dateLabel: formatBusinessDate(new Date(stamp)),
    timeLabel: timeOnly(stamp),
    items: items.map((item) => ({
      name: displayName(item.name_snapshot),
      quantity: item.quantity,
      unitPrice: Number(item.unit_price),
      lineTotal: Number(item.line_total),
    })),
    subtotal: Number(session.subtotal),
    discountPercent: Number(session.discount_percent),
    discountAmount: Number(session.discount_amount),
    // The engine does not calculate tax today. The field exists so the GST
    // section in every template is written and tested now, rather than
    // being bolted on later when it would touch six files at once.
    charges: Array.isArray(session.charges) ? session.charges : [],
    taxes: [],
    total: Number(session.total),
    amountPaid: Number(session.amount_paid),
    paymentStatus: session.payment_status,
    paymentMethod: session.payment_method ?? null,
    // The seller's instructions, on the document the customer and the
    // kitchen actually look at. Grouped by heading and joined onto one
    // line, because all six templates render this as a single string and
    // none of them preserves newlines.
    notes: renderNotesLine(Array.isArray(stored.session.notes) ? stored.session.notes : []),
  };
}

// --- Statement ------------------------------------------------------------

import type { StatementData, StatementLine } from "./statementData.js";
import type { CustomerHistory } from "./customerStore.js";
import { rest } from "./catalogStore.js";

// Builds a statement from bills that are ALREADY STORED. Every figure is
// copied; the totals are sums of stored bill totals, never a recalculation
// from line items. A statement is what gets shown when there is a
// disagreement about money, so it must agree with the bills exactly.
export async function toStatementData(
  history: CustomerHistory,
  business: BusinessProfile,
  allBills: {
    id: string; bill_no: number; total: string | number; amount_paid: string | number;
    payment_status: "pending" | "partial" | "paid"; status: string;
    created_at: string; finalized_at: string | null;
  }[],
): Promise<StatementData> {
  // One query for every line on the statement, rather than one per bill.
  const ids = allBills.map((b) => b.id);
  const items = ids.length
    ? ((await rest(
        `bill_items?bill_session_id=in.(${ids.join(",")})&order=position.asc&select=bill_session_id,name_snapshot,quantity`,
      )) as { bill_session_id: string; name_snapshot: string; quantity: number }[])
    : [];

  const byBill = new Map<string, string[]>();
  for (const item of items) {
    const list = byBill.get(item.bill_session_id) ?? [];
    list.push(`${item.name_snapshot} × ${item.quantity}`);
    byBill.set(item.bill_session_id, list);
  }

  const lines: StatementLine[] = allBills.map((bill) => {
    const stamp = bill.finalized_at ?? bill.created_at;
    const summary = byBill.get(bill.id) ?? [];
    return {
      billNo: bill.bill_no,
      dateLabel: formatBusinessDate(new Date(stamp)),
      timeLabel: timeOnly(stamp),
      total: Number(bill.total),
      amountPaid: Number(bill.amount_paid),
      paymentStatus: bill.payment_status,
      confirmed: bill.status === "finalized",
      // Long orders are truncated so a row cannot push the money column off
      // the page; the full bill is always available by its number.
      itemSummary:
        summary.length <= 3
          ? summary.join(", ")
          : `${summary.slice(0, 3).join(", ")} +${summary.length - 3} more`,
    };
  });

  return {
    business: {
      name: business.name,
      phone: business.phone ?? null,
      address: business.address ?? null,
      gstin: business.gstin ?? null,
      upiId: business.upiId ?? null,
      logoUrl: business.logoUrl ?? null,
      footerNote: business.footerNote ?? null,
    },
    customerName: displayName(history.customer.name),
    periodLabel: history.periodLabel ?? "All time",
    generatedLabel: formatBusinessDateTime(new Date()),
    lines,
    billCount: history.billCount,
    draftCount: lines.filter((l) => !l.confirmed).length,
    draftTotal:
      Math.round(lines.filter((l) => !l.confirmed).reduce((t, l) => t + l.total, 0) * 100) / 100,
    grandTotal: history.lifetimeTotal,
    paidTotal: Math.round((history.lifetimeTotal - history.outstanding) * 100) / 100,
    outstanding: history.outstanding,
  };
}
