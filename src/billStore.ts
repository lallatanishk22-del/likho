import type { Bill } from "./types.js";
import type { ParsedOrder } from "./structuredOrder.js";
import { rest } from "./catalogStore.js";
import { startOfBusinessDay, type DateRange } from "./businessDay.js";
import { findCustomer, findOrCreateCustomer } from "./customerStore.js";

// Persistence for BillSession — the durable, versioned state that turns a
// one-shot reply into something the seller can come back to, edit, and
// update. All money written here was computed by calculator.ts; nothing in
// this file does arithmetic.

export type BillStatus = "draft" | "updated" | "finalized";
export type ChangeReason = "created" | "manual_edit" | "conversation_update";

export interface BillSessionRow {
  id: string;
  business_id: string;
  // Per-business sequential transaction identity (#1042). Allocated
  // atomically in Postgres, never derived from the UUID.
  bill_no: number;
  // The name as the seller wrote it on THIS bill — a snapshot, kept for
  // the same reason unit_price is: an old bill must not be rewritten by a
  // later change. customer_id is the durable identity it points at.
  customer_ref: string | null;
  customer_id: string | null;
  status: BillStatus;
  version: number;
  subtotal: string | number;
  discount_percent: string | number;
  discount_amount: string | number;
  total: string | number;
  last_checked_message_id: string | null;
  created_at: string;
  finalized_at: string | null;
  // Payment is only ever set by the seller's explicit confirmation, never
  // inferred from a customer's message.
  payment_status: "pending" | "partial" | "paid";
  amount_paid: string | number;
  updated_at: string;
}

export interface BillItemRow {
  id: string;
  name_snapshot: string;
  quantity: number;
  unit_price: string | number;
  line_total: string | number;
  price_source: "stated" | "catalog" | "manual";
  position: number;
}

export interface StoredBill {
  session: BillSessionRow;
  items: BillItemRow[];
}

// Records the full state of a bill at a given version, so any earlier
// version can be reconstructed after later edits.
async function writeVersion(
  sessionId: string,
  version: number,
  reason: ChangeReason,
  snapshot: unknown,
): Promise<void> {
  await rest("bill_versions", {
    method: "POST",
    body: JSON.stringify({
      bill_session_id: sessionId,
      version,
      change_reason: reason,
      snapshot,
    }),
  });
}

// Creates a NEW bill session. Only called when the seller hands Likho a
// fresh order — never when an existing bill changes (that versions in
// place, so one order stays one transaction).
// Asks Postgres for the next number for this business. Kept server-side
// and atomic on purpose: two orders arriving at once must never be handed
// the same bill number.
async function allocateBillNo(businessId: string): Promise<number> {
  const result = (await rest("rpc/allocate_bill_no", {
    method: "POST",
    body: JSON.stringify({ p_business_id: businessId }),
  })) as number;
  return result;
}

export async function createBillSession(
  businessId: string,
  parsed: ParsedOrder,
  bill: Bill,
  sourceMessageId: string | null,
): Promise<StoredBill> {
  const billNo = await allocateBillNo(businessId);

  // A customer record is created the first time a name appears on a bill.
  // This is the whole "the CRM builds itself" mechanic: the seller never
  // adds a customer, they just bill one.
  const customer = parsed.customer
    ? await findOrCreateCustomer(businessId, parsed.customer)
    : null;

  const created = (await rest("bill_sessions", {
    method: "POST",
    body: JSON.stringify({
      business_id: businessId,
      bill_no: billNo,
      customer_ref: parsed.customer,
      customer_id: customer?.id ?? null,
      source_message_id: sourceMessageId,
      last_checked_message_id: sourceMessageId,
      status: "draft",
      version: 1,
      subtotal: bill.subtotal,
      discount_percent: bill.discountPercent,
      discount_amount: bill.discountAmount,
      total: bill.total,
    }),
  })) as BillSessionRow[];

  const session = created[0]!;

  const itemRows = bill.lines.map((line, index) => ({
    bill_session_id: session.id,
    name_snapshot: line.name,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    line_total: line.lineTotal,
    price_source: line.priceSource ?? "stated",
    position: index,
  }));

  const items = (await rest("bill_items", {
    method: "POST",
    body: JSON.stringify(itemRows),
  })) as BillItemRow[];

  await writeVersion(session.id, 1, "created", { session, items });

  return { session, items };
}

// The seller's current working bill for this business: most recently
// updated one that isn't finalized yet.
// The seller's current working bill. Scoped to TODAY on purpose: an
// unconfirmed bill from a previous day is abandoned, not current, and
// silently attaching "add 2 chai" to yesterday's order would corrupt a
// record the seller had already moved on from.
export async function getCurrentDraft(businessId: string): Promise<StoredBill | null> {
  const since = startOfBusinessDay().toISOString();
  const sessions = (await rest(
    `bill_sessions?business_id=eq.${businessId}&status=in.(draft,updated)` +
      `&created_at=gte.${since}&order=updated_at.desc&limit=1&select=*`,
  )) as BillSessionRow[];

  if (sessions.length === 0) return null;
  const session = sessions[0]!;

  const items = (await rest(
    `bill_items?bill_session_id=eq.${session.id}&order=position.asc&select=*`,
  )) as BillItemRow[];

  return { session, items };
}

export async function finalizeBill(sessionId: string): Promise<void> {
  await rest(`bill_sessions?id=eq.${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "finalized", finalized_at: new Date().toISOString() }),
  });
}

// Today's finalized bills — the end-of-day view. Deliberately counts only
// finalized bills: a draft is not a sale.
export interface DaySummary {
  count: number;
  total: number;
  paidTotal: number;
  unpaidTotal: number;
  // Bills started today that were never confirmed. Previously invisible:
  // a seller could work all day, leave most bills unconfirmed, and see a
  // daily total far below what they had actually done — with no way to
  // find the missing ones.
  openCount: number;
  openTotal: number;
}

// Sales for any period. Defaults to today when no range is given, so the
// bare "sales" question is unchanged.
export async function getSales(
  businessId: string,
  range?: DateRange,
): Promise<DaySummary> {
  const from = (range?.from ?? startOfBusinessDay()).toISOString();
  const toClause = range ? `&finalized_at=lt.${range.to.toISOString()}` : "";
  const openToClause = range ? `&created_at=lt.${range.to.toISOString()}` : "";

  const confirmed = (await rest(
    `bill_sessions?business_id=eq.${businessId}&status=eq.finalized` +
      `&finalized_at=gte.${from}${toClause}&select=total,amount_paid,payment_status`,
  )) as { total: string | number; amount_paid: string | number }[];

  const open = (await rest(
    `bill_sessions?business_id=eq.${businessId}&status=in.(draft,updated)` +
      `&created_at=gte.${from}${openToClause}&select=total`,
  )) as { total: string | number }[];

  const total = confirmed.reduce((sum, r) => sum + Number(r.total), 0);
  const paidTotal = confirmed.reduce((sum, r) => sum + Number(r.amount_paid), 0);

  return {
    count: confirmed.length,
    total: Math.round(total * 100) / 100,
    paidTotal: Math.round(paidTotal * 100) / 100,
    unpaidTotal: Math.round((total - paidTotal) * 100) / 100,
    openCount: open.length,
    openTotal: Math.round(open.reduce((sum, r) => sum + Number(r.total), 0) * 100) / 100,
  };
}

export async function getTodaysSales(businessId: string): Promise<DaySummary> {
  return getSales(businessId);
}

// Bills started today and never confirmed, newest first — so "show open
// bills" can list exactly what is unaccounted for.
export async function getOpenBills(businessId: string): Promise<BillSessionRow[]> {
  const since = startOfBusinessDay().toISOString();
  return (await rest(
    `bill_sessions?business_id=eq.${businessId}&status=in.(draft,updated)` +
      `&created_at=gte.${since}&order=created_at.desc&select=*`,
  )) as BillSessionRow[];
}

// ── Manual edit ──────────────────────────────────────────────────────
//
// The seller changing their own bill directly. This is deliberately a
// SEPARATE path from anything the model proposes: here the seller states
// exactly what they want, so there is no extraction, no trust layer, and
// no approval step — they already approved it by typing it.
//
// Every mutation ends in a full deterministic recalculation, never an
// incremental patch of the totals.

import { calculateBill } from "./calculator.js";
import type { OrderItem } from "./types.js";

// Recomputes the whole bill from its stored items and writes a new
// version. Called after EVERY mutation so totals can never drift out of
// step with the items.
export async function recalculateBill(
  sessionId: string,
  reason: ChangeReason,
): Promise<StoredBill> {
  const sessions = (await rest(`bill_sessions?id=eq.${sessionId}&select=*`)) as BillSessionRow[];
  const session = sessions[0]!;

  const items = (await rest(
    `bill_items?bill_session_id=eq.${sessionId}&order=position.asc&select=*`,
  )) as BillItemRow[];

  const orderItems: OrderItem[] = items.map((i) => ({
    name: i.name_snapshot,
    quantity: i.quantity,
    unitPrice: Number(i.unit_price),
  }));

  const bill = calculateBill(orderItems, Number(session.discount_percent));
  const nextVersion = session.version + 1;

  // Line totals are rewritten too — a quantity change must not leave a
  // stale line_total behind.
  for (let i = 0; i < items.length; i++) {
    await rest(`bill_items?id=eq.${items[i]!.id}`, {
      method: "PATCH",
      body: JSON.stringify({ line_total: bill.lines[i]!.lineTotal }),
    });
  }

  const updated = (await rest(`bill_sessions?id=eq.${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({
      subtotal: bill.subtotal,
      discount_amount: bill.discountAmount,
      total: bill.total,
      version: nextVersion,
      status: "updated",
      updated_at: new Date().toISOString(),
    }),
  })) as BillSessionRow[];

  const refreshed = (await rest(
    `bill_items?bill_session_id=eq.${sessionId}&order=position.asc&select=*`,
  )) as BillItemRow[];

  await writeVersion(sessionId, nextVersion, reason, {
    session: updated[0],
    items: refreshed,
  });

  return { session: updated[0]!, items: refreshed };
}

export async function addItemToBill(
  sessionId: string,
  item: { name: string; quantity: number; unitPrice: number; productId: string | null; priceSource: "stated" | "catalog" | "manual" },
): Promise<StoredBill> {
  const existing = (await rest(
    `bill_items?bill_session_id=eq.${sessionId}&order=position.asc&select=*`,
  )) as BillItemRow[];

  // Adding an item the bill already has at the same price increases that
  // line instead of opening a second one. Two "Lassi" rows on one bill is
  // confusing to read out to a customer, and it is never what the seller
  // meant by "add 2 lassi".
  const sameLine = existing.find(
    (i) =>
      i.name_snapshot.toLowerCase() === item.name.toLowerCase() &&
      Number(i.unit_price) === item.unitPrice,
  );
  if (sameLine) {
    return setItemQuantity(sessionId, sameLine.id, sameLine.quantity + item.quantity);
  }

  const nextPosition = existing.length === 0 ? 0 : Math.max(...existing.map((e) => e.position)) + 1;

  await rest("bill_items", {
    method: "POST",
    body: JSON.stringify({
      bill_session_id: sessionId,
      product_id: item.productId,
      name_snapshot: item.name,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      line_total: item.quantity * item.unitPrice,
      price_source: item.priceSource,
      position: nextPosition,
    }),
  });

  return recalculateBill(sessionId, "manual_edit");
}

// Returns null when nothing matched, so the caller can tell the seller
// rather than silently doing nothing.
export async function removeItemFromBill(
  sessionId: string,
  name: string,
): Promise<StoredBill | null> {
  const items = (await rest(
    `bill_items?bill_session_id=eq.${sessionId}&select=id,name_snapshot`,
  )) as { id: string; name_snapshot: string }[];

  const target = name.toLowerCase().trim();
  const match = items.find(
    (i) => i.name_snapshot.toLowerCase() === target || i.name_snapshot.toLowerCase().includes(target),
  );
  if (!match) return null;

  await rest(`bill_items?id=eq.${match.id}`, { method: "DELETE" });
  return recalculateBill(sessionId, "manual_edit");
}

// Looks a bill up by the number the seller actually said ("#1042"), scoped
// to their business so one seller can never address another's transaction.
export async function getBillByNo(
  businessId: string,
  billNo: number,
): Promise<StoredBill | null> {
  const sessions = (await rest(
    `bill_sessions?business_id=eq.${businessId}&bill_no=eq.${billNo}&limit=1&select=*`,
  )) as BillSessionRow[];
  if (sessions.length === 0) return null;
  const session = sessions[0]!;

  const items = (await rest(
    `bill_items?bill_session_id=eq.${session.id}&order=position.asc&select=*`,
  )) as BillItemRow[];
  return { session, items };
}

// Looks a bill up by the CUSTOMER the seller named ("open ravi bill").
//
// Two steps, deliberately: resolve the NAME to a customer record, then
// find that record's bills. Matching happens once, in customerStore,
// against the seller's actual customer list — not against whatever names
// happen to appear on recent bills.
//
// Returns null when that customer has no bill. That null matters: the
// caller must say "no bill for Ravi" rather than fall back to whatever
// draft happens to be open, which is how "open ravi bill" once answered
// with a different customer's transaction — and, on the payment path,
// would have marked the wrong person's bill paid.
export async function getLatestBillForCustomer(
  businessId: string,
  customer: string,
): Promise<StoredBill | null> {
  const match = await findCustomer(businessId, customer);
  if (!match) return null;

  const sessions = (await rest(
    `bill_sessions?business_id=eq.${businessId}&customer_id=eq.${match.id}` +
      `&order=updated_at.desc&limit=1&select=*`,
  )) as BillSessionRow[];
  if (sessions.length === 0) return null;
  const session = sessions[0]!;

  const items = (await rest(
    `bill_items?bill_session_id=eq.${session.id}&order=position.asc&select=*`,
  )) as BillItemRow[];
  return { session, items };
}

// Every bill for one customer, newest first — their order history, and
// what "what does Ravi owe" will be answered from.
export async function getBillsForCustomer(
  businessId: string,
  customerId: string,
): Promise<BillSessionRow[]> {
  return (await rest(
    `bill_sessions?business_id=eq.${businessId}&customer_id=eq.${customerId}` +
      `&order=created_at.desc&select=*`,
  )) as BillSessionRow[];
}

// Attaches a name to a bill that was created without one, and creates the
// customer record if this is the first time they appear. Both fields move
// together: the snapshot the bill shows and the identity it points at can
// never disagree.
export async function setBillCustomer(
  businessId: string,
  sessionId: string,
  name: string,
): Promise<StoredBill | null> {
  const customer = await findOrCreateCustomer(businessId, name);
  if (!customer) return null;

  await rest(`bill_sessions?id=eq.${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ customer_ref: customer.name, customer_id: customer.id }),
  });

  return recalculateBill(sessionId, "manual_edit");
}

// Records a payment against a bill. The status is DERIVED from the amounts
// (deterministic, like every other money decision here) rather than taken
// from whatever the seller's sentence implied.
export async function recordPayment(
  sessionId: string,
  amount: number | null,
): Promise<StoredBill | null> {
  const sessions = (await rest(
    `bill_sessions?id=eq.${sessionId}&limit=1&select=*`,
  )) as BillSessionRow[];
  if (sessions.length === 0) return null;
  const session = sessions[0]!;

  const total = Number(session.total);
  // A payment with no stated amount means "paid in full".
  const paidNow = amount === null ? total : Number(session.amount_paid) + amount;
  const clamped = Math.min(Math.round(paidNow * 100) / 100, total);
  const status: BillSessionRow["payment_status"] =
    clamped >= total ? "paid" : clamped > 0 ? "partial" : "pending";

  const updated = (await rest(`bill_sessions?id=eq.${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({
      amount_paid: clamped,
      payment_status: status,
      updated_at: new Date().toISOString(),
    }),
  })) as BillSessionRow[];

  const items = (await rest(
    `bill_items?bill_session_id=eq.${sessionId}&order=position.asc&select=*`,
  )) as BillItemRow[];
  return { session: updated[0]!, items };
}

// Sets an item's quantity IN PLACE. Used by conversational corrections
// ("actually paneer was 3"). Editing in place rather than removing and
// re-adding matters: a correction must not silently reorder the seller's
// bill, which is confusing when they are reading it back to a customer.
// The whole bill is still recalculated deterministically afterwards.
export async function setItemQuantity(
  sessionId: string,
  itemId: string,
  quantity: number,
): Promise<StoredBill> {
  await rest(`bill_items?id=eq.${itemId}`, {
    method: "PATCH",
    body: JSON.stringify({ quantity }),
  });
  return recalculateBill(sessionId, "manual_edit");
}

// Sets the discount on an existing bill and recalculates it.
//
// The percentage is stored; calculator.ts turns it into money, clamped to
// [0, subtotal] as it does for a discount stated at order time. Nothing
// here does arithmetic.
export async function setBillDiscount(
  sessionId: string,
  discountPercent: number,
): Promise<StoredBill> {
  await rest(`bill_sessions?id=eq.${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ discount_percent: discountPercent }),
  });
  return recalculateBill(sessionId, "manual_edit");
}
