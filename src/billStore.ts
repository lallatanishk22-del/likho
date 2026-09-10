import type { Bill } from "./types.js";
import type { ParsedOrder } from "./structuredOrder.js";
import { rest } from "./catalogStore.js";

// Persistence for BillSession — the durable, versioned state that turns a
// one-shot reply into something the seller can come back to, edit, and
// update. All money written here was computed by calculator.ts; nothing in
// this file does arithmetic.

export type BillStatus = "draft" | "updated" | "finalized";
export type ChangeReason = "created" | "manual_edit" | "conversation_update";

export interface BillSessionRow {
  id: string;
  business_id: string;
  customer_ref: string | null;
  status: BillStatus;
  version: number;
  subtotal: string | number;
  discount_percent: string | number;
  discount_amount: string | number;
  total: string | number;
  last_checked_message_id: string | null;
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
export async function createBillSession(
  businessId: string,
  parsed: ParsedOrder,
  bill: Bill,
  sourceMessageId: string | null,
): Promise<StoredBill> {
  const created = (await rest("bill_sessions", {
    method: "POST",
    body: JSON.stringify({
      business_id: businessId,
      customer_ref: parsed.customer,
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
export async function getCurrentDraft(businessId: string): Promise<StoredBill | null> {
  const sessions = (await rest(
    `bill_sessions?business_id=eq.${businessId}&status=in.(draft,updated)` +
      `&order=updated_at.desc&limit=1&select=*`,
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
export async function getTodaysSales(
  businessId: string,
): Promise<{ count: number; total: number }> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const rows = (await rest(
    `bill_sessions?business_id=eq.${businessId}&status=eq.finalized` +
      `&finalized_at=gte.${startOfDay.toISOString()}&select=total`,
  )) as { total: string | number }[];

  return {
    count: rows.length,
    total: rows.reduce((sum, r) => sum + Number(r.total), 0),
  };
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
    `bill_items?bill_session_id=eq.${sessionId}&select=position`,
  )) as { position: number }[];
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
