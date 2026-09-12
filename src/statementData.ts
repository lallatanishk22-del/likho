import type { BillBusiness } from "./billData.js";

// A customer statement: every bill over a period, as one document.
//
// The same rule as BillData, and it matters more here because a statement
// is what a seller shows a customer when there is a disagreement about
// money: EVERY figure is copied from a stored bill. Nothing on this page is
// derived from line items, and the totals are sums of stored bill totals —
// never a recalculation.
//
// The seller asked for this to be reliable in exactly those words: "we
// can't screw up". So the statement reads the bills table the way a ledger
// reads a ledger, and adds nothing of its own.

export interface StatementLine {
  billNo: number;
  dateLabel: string;
  timeLabel: string;
  total: number;
  amountPaid: number;
  paymentStatus: "pending" | "partial" | "paid";
  confirmed: boolean;
  itemSummary: string;
}

export interface StatementData {
  business: BillBusiness;
  customerName: string;
  periodLabel: string;
  generatedLabel: string;
  lines: StatementLine[];
  billCount: number;
  grandTotal: number;
  paidTotal: number;
  outstanding: number;
}
