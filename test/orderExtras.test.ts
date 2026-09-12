import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOrderExtras } from "../src/orderExtras.js";
import { calculateBill } from "../src/calculator.js";

// --- The real order that was refused -------------------------------------
//
//   2 paneer tikka 180
//   1 butter naan 40
//   3 coke 40
//   delivery 30
//   upi
//   customer Rahul
//
// Sent whole: "a price is reused across multiple items while the message
// contains other unexplained number(s) (30)". The trust layer was right by
// its own rules — 40 appears twice, and 30 belonged to nothing it knew
// about. It had no concept of a delivery charge, a payment mode, or an
// explicit customer line.

const REAL = `2 paneer tikka 180
1 butter naan 40
3 coke 40
delivery 30
upi
customer Rahul`;

test("the real order splits into items, charge, payment and customer", () => {
  const x = parseOrderExtras(REAL);
  assert.deepEqual(x.charges, [{ label: "Delivery", amount: 30 }]);
  assert.equal(x.paymentMethod, "UPI");
  assert.equal(x.customer, "Rahul");
  assert.equal(x.rest, "2 paneer tikka 180\n1 butter naan 40\n3 coke 40");
});

test("what reaches the extractor is only items", () => {
  const rest = parseOrderExtras(REAL).rest;
  assert.ok(!/delivery|upi|customer/i.test(rest), `non-items survived: ${rest}`);
  assert.equal(rest.split("\n").length, 3);
});

// --- Charges -------------------------------------------------------------

test("charges are recognised by name, either way round", () => {
  assert.deepEqual(parseOrderExtras("delivery 30").charges, [{ label: "Delivery", amount: 30 }]);
  assert.deepEqual(parseOrderExtras("30 delivery").charges, [{ label: "Delivery", amount: 30 }]);
  assert.deepEqual(parseOrderExtras("packing 20").charges, [{ label: "Packing", amount: 20 }]);
  assert.deepEqual(parseOrderExtras("delivery charge 40").charges, [{ label: "Delivery", amount: 40 }]);
});

test("common misspellings of delivery are caught", () => {
  assert.equal(parseOrderExtras("delivary 30").charges[0]?.label, "Delivery");
});

test("an UNKNOWN word with a number stays an item", () => {
  // The closed list is the safety: guessing turns a product into a fee
  // that no discount touches. "2 samosa 20" must never become a charge.
  const x = parseOrderExtras("samosa 20");
  assert.deepEqual(x.charges, []);
  assert.equal(x.rest, "samosa 20");
});

// --- Payment mode --------------------------------------------------------

test("a line that is only a payment word sets the method", () => {
  for (const [line, want] of [
    ["upi", "UPI"], ["cash", "Cash"], ["gpay", "UPI"], ["phonepe", "UPI"],
    ["card", "Card"], ["paid cash", "Cash"], ["mode: upi", "UPI"],
  ] as [string, string][]) {
    assert.equal(parseOrderExtras(line).paymentMethod, want, line);
  }
});

test("a payment word inside an order line is left alone", () => {
  // "2 cash counter special" is an item, not a payment mode.
  const x = parseOrderExtras("2 upi special 40");
  assert.equal(x.paymentMethod, null);
  assert.equal(x.rest, "2 upi special 40");
});

// --- Customer line -------------------------------------------------------

test("an explicit customer line is read", () => {
  assert.equal(parseOrderExtras("customer Rahul").customer, "Rahul");
  assert.equal(parseOrderExtras("cust: ravi bhanushali").customer, "Ravi Bhanushali");
});

test("a customer line containing a digit is not a name", () => {
  // "customer 2 chai" is an order, however oddly phrased.
  assert.equal(parseOrderExtras("customer 2 chai").customer, null);
});

// --- The money ------------------------------------------------------------

test("a charge is added AFTER the discount, never discounted", () => {
  // 2×180 + 1×40 + 3×40 = 520, less 10% = 468, plus 30 delivery = 498.
  // If delivery were an item it would be discounted to 27 and the total
  // would be 495 — quietly wrong by three rupees, every single bill.
  const bill = calculateBill(
    [
      { name: "paneer tikka", quantity: 2, unitPrice: 180 },
      { name: "butter naan", quantity: 1, unitPrice: 40 },
      { name: "coke", quantity: 3, unitPrice: 40 },
    ],
    10,
    [{ label: "Delivery", amount: 30 }],
  );
  assert.equal(bill.subtotal, 520);
  assert.equal(bill.discountAmount, 52);
  assert.equal(bill.chargesTotal, 30);
  assert.equal(bill.total, 498);
});

test("the real order totals correctly with no discount", () => {
  const bill = calculateBill(
    [
      { name: "paneer tikka", quantity: 2, unitPrice: 180 },
      { name: "butter naan", quantity: 1, unitPrice: 40 },
      { name: "coke", quantity: 3, unitPrice: 40 },
    ],
    0,
    [{ label: "Delivery", amount: 30 }],
  );
  assert.equal(bill.total, 550);
});

test("a negative charge cannot become a backdoor discount", () => {
  const bill = calculateBill([{ name: "chai", quantity: 1, unitPrice: 100 }], 0,
    [{ label: "Delivery", amount: -50 }]);
  assert.equal(bill.chargesTotal, 0);
  assert.equal(bill.total, 100);
});

test("no charges leaves the existing maths untouched", () => {
  const bill = calculateBill([{ name: "chai", quantity: 2, unitPrice: 15 }], 10);
  assert.equal(bill.subtotal, 30);
  assert.equal(bill.discountAmount, 3);
  assert.equal(bill.chargesTotal, 0);
  assert.equal(bill.total, 27);
});

test("an ordinary order is returned unchanged", () => {
  const plain = "ravi 2 paneer 1 chai";
  const x = parseOrderExtras(plain);
  assert.deepEqual(x.charges, []);
  assert.equal(x.paymentMethod, null);
  assert.equal(x.customer, null);
  assert.equal(x.rest, plain);
});
