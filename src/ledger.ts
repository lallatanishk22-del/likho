import { rest } from "./catalogStore.js";
import type { DateRange } from "./businessDay.js";

// The sales LEDGER: every bill in a period, one row each, split three ways —
// Billed, Received, Due. It answers "how much did I sell / get / am I owed"
// for a day, a week or a month with one rule, so the numbers can't disagree.
//
// Every bill counts. Confirmation is shown per row, not used to hide rows:
// sellers rarely tap Confirm, and a report that left those bills out read
// "nothing sold" for a month that had ₹18,740 of bills in it.
//
// All money is added in whole paise, so Billed = Received + Due exactly.

export type LedgerStatus = "Paid" | "Part paid" | "Unpaid";

export interface LedgerRow {
  billNo: number;
  date: Date;
  customer: string | null;
  billed: number;
  received: number;
  due: number;
  status: LedgerStatus;
  confirmed: boolean;
}

export interface Ledger {
  label: string;
  rows: LedgerRow[];
  billed: number;
  received: number;
  due: number;
  unconfirmedCount: number;
}

export interface RawLedgerBill {
  bill_no: number;
  created_at: string;
  customer_ref: string | null;
  total: string | number;
  amount_paid: string | number;
  status: string;
}

const paise = (n: string | number): number => Math.round(Number(n) * 100);
const rupees = (p: number): number => p / 100;

export function buildLedger(label: string, bills: RawLedgerBill[]): Ledger {
  let billed = 0;
  let received = 0;
  const rows = bills.map((b) => {
    const total = paise(b.total);
    // Money beyond the bill is change, not this bill's receipt — keeping it
    // out is what makes every row satisfy Billed = Received + Due.
    const got = Math.max(0, Math.min(paise(b.amount_paid), total));
    billed += total;
    received += got;
    return {
      billNo: b.bill_no,
      date: new Date(b.created_at),
      customer: b.customer_ref,
      billed: rupees(total),
      received: rupees(got),
      due: rupees(total - got),
      status: (got === 0 ? "Unpaid" : got >= total ? "Paid" : "Part paid") as LedgerStatus,
      confirmed: b.status === "finalized",
    };
  });
  return {
    label,
    rows,
    billed: rupees(billed),
    received: rupees(received),
    due: rupees(billed - received),
    unconfirmedCount: rows.filter((r) => !r.confirmed).length,
  };
}

// A customer named by a button. Scoped to THIS shop, so an id that belongs
// to another business finds nothing.
export async function getLedgerCustomer(
  businessId: string,
  customerId: string,
): Promise<{ id: string; name: string } | null> {
  const rows = (await rest(
    `customers?business_id=eq.${businessId}&id=eq.${encodeURIComponent(customerId)}&select=id,name&limit=1`,
  )) as { id: string; name: string }[];
  return rows[0] ?? null;
}

// One shop's bills in a period, or one customer's (all time when no period).
export async function getLedger(
  businessId: string,
  range: DateRange | null,
  customerId: string | null = null,
): Promise<Ledger> {
  const when = range
    ? `&created_at=gte.${range.from.toISOString()}&created_at=lt.${range.to.toISOString()}`
    : "";
  const who = customerId ? `&customer_id=eq.${customerId}` : "";
  const bills = (await rest(
    `bill_sessions?business_id=eq.${businessId}${when}${who}` +
      `&order=created_at.asc&select=bill_no,created_at,customer_ref,total,amount_paid,status`,
  )) as RawLedgerBill[];
  return buildLedger(range?.label ?? "All time", bills);
}
