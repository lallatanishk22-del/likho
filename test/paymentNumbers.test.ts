import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent } from "../src/intent.js";
import { decidePayment, firstBareNumber } from "../src/paymentNumbers.js";

function decide(text: string, existingBills: number[]) {
  const i = classifyIntent(text);
  const bare = firstBareNumber(i.numbers ?? []);
  const isBill = i.billNo === null && !i.customer && bare !== null && existingBills.includes(bare);
  return decidePayment(i.billNo, i.amount, i.customer, i.numbers ?? [], isBill);
}

test("a bill number typed without # is the bill, the other number is the amount", () => {
  assert.deepEqual(decide("1003 paid 100", [1003]), { billNo: 1003, amount: 100 });
});

test("a lone number that is a real bill is asked about, not guessed", () => {
  const d = decide("1003 paid", [1003]);
  assert.ok("ask" in d && d.ask.includes("bill number or the amount"));
});

test("a number marked as money is never a bill number", () => {
  assert.deepEqual(decide("paid ₹1003", [1003]), { billNo: null, amount: 1003 });
  assert.deepEqual(decide("paid 1003 rs", [1003]), { billNo: null, amount: 1003 });
});

test("a number that is not a bill is an amount, as before", () => {
  assert.deepEqual(decide("paid 500", [1003]), { billNo: null, amount: 500 });
});

test("# and a named customer already identify the bill", () => {
  assert.deepEqual(decide("#1003 paid 100", [1003]), { billNo: 1003, amount: 100 });
  assert.equal(classifyIntent("rahul paid 1003").amount, 1003);
  assert.deepEqual(decide("rahul paid 1003", [1003]), { billNo: null, amount: 1003 });
});
