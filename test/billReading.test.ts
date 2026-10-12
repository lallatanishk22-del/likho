import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStoredBill } from "../src/chatFormat.js";
import { billHasItem, billCustomer } from "../eval/billReading.js";
import type { StoredBill } from "../src/billStore.js";

// The evals read bills through eval/billReading.ts. If the bill layout
// changes and this breaks, fix the reader — otherwise every live eval
// silently scores zero (that happened once: 0/26 and 0/10).
const stored = {
  session: {
    bill_no: 1042, customer_ref: "ria bhanushali", subtotal: 330, discount_percent: 0, discount_amount: 0,
    charges: [], charges_total: 0, total: 330, amount_paid: 0, payment_status: "pending", payment_method: null,
    notes: [], created_at: "2026-10-12T05:00:00Z", finalized_at: null,
  },
  items: [
    { name_snapshot: "mudpie", quantity: 3, unit_price: 100, line_total: 300 },
    { name_snapshot: "chai", quantity: 2, unit_price: 15, line_total: 30 },
  ],
} as unknown as StoredBill;

test("the eval reader finds every item and the customer in the live bill layout", () => {
  const text = `<pre>${renderStoredBill(stored)}</pre>`;
  assert.ok(billHasItem(text, "Mudpie", 3));
  assert.ok(billHasItem(text, "Chai", 2));
  assert.ok(!billHasItem(text, "Chai", 3), "a wrong quantity must not match");
  assert.equal(billCustomer(text), "Ria Bhanushali");
});

test("a bill with no customer reads as no name", () => {
  const text = renderStoredBill({ ...stored, session: { ...stored.session, customer_ref: null } } as StoredBill);
  assert.equal(billCustomer(text), null);
});
