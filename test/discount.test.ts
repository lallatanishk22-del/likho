import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiscount } from "../src/discount.js";
import { calculateBill } from "../src/calculator.js";

const pct = (t: string) => parseDiscount(t).percent;
const rest = (t: string) => parseDiscount(t).rest;

// --- The failure that put this here -------------------------------------
//
// The local model could not cope with a discount. Every shape broke
// differently: "No price found for cakes", invalid JSON, and the trust
// layer reporting a missing item — because the extra number was read as a
// price, or counted as another item's quantity.
//
// A discount is not messy human language. It is a number beside "percent",
// "%" or "off" — a regex, and a regex is exact.

test("the reported message parses", () => {
  assert.equal(pct("dhruv 2 cakes 20 percent discount"), 20);
  assert.equal(rest("dhruv 2 cakes 20 percent discount"), "dhruv 2 cakes");
});

test("every way a seller writes a discount", () => {
  for (const [message, want] of [
    ["dhruv 2 cakes 20% off", 20],
    ["dhruv 2 cakes 20% discount", 20],
    ["dhruv 2 cakes 20%", 20],
    ["dhruv 2 cakes 10 pct off", 10],
    ["dhruv 2 cakes discount 15%", 15],
    ["dhruv 2 cakes discount of 15 percent", 15],
    ["dhruv 2 cakes flat 30% off", 30],
    ["dhruv 2 cakes 12.5% off", 12.5],
  ] as [string, number][]) {
    assert.equal(pct(message), want, message);
  }
});

test("the items survive with the discount removed", () => {
  // What reaches the extractor must still be a complete order.
  for (const message of [
    "dhruv 2 cakes 20% off",
    "dhruv 2 cakes discount 15%",
    "ravi 2 paneer 3 chai flat 10 percent off",
  ]) {
    const remaining = rest(message);
    assert.ok(!/%|percent|pct|discount|off/i.test(remaining), `${message} -> ${remaining}`);
    assert.ok(remaining.includes("2"), "the quantity was eaten");
  }
});

// --- Never invent a discount --------------------------------------------

test("an order with no discount gets none", () => {
  for (const message of [
    "dhruv 2 cakes",
    "ravi 2 paneer 1 chai",
    "2 chai 3 samosa",
    "ravi paid 500",
  ]) {
    assert.equal(pct(message), null, message);
    assert.equal(rest(message), message, "the message was altered");
  }
});

test("a quantity is never read as a discount", () => {
  // "20 cakes" must stay twenty cakes.
  assert.equal(pct("aryan 20 cakes"), null);
  assert.equal(rest("aryan 20 cakes"), "aryan 20 cakes");
});

test("a price is never read as a discount", () => {
  assert.equal(pct("2 cakes 150 each"), null);
});

// --- Refusing nonsense rather than clamping it quietly ------------------

test("a discount over 100% is not read at all", () => {
  // Clamping would hide the typo; leaving it unread keeps the number
  // visible in the message where the seller can see it.
  assert.equal(pct("2 cakes 200 percent discount"), null);
  assert.equal(pct("2 cakes 150% off"), null);
});

test("a zero or negative discount is not read", () => {
  assert.equal(pct("2 cakes 0 percent discount"), null);
});

// --- The money is still the calculator's --------------------------------

test("the parsed percentage flows through the existing engine unchanged", () => {
  const bill = calculateBill([{ name: "cake", quantity: 2, unitPrice: 150 }], pct("2 cakes 20% off")!);
  assert.equal(bill.subtotal, 300);
  assert.equal(bill.discountAmount, 60);
  assert.equal(bill.total, 240);
});

test("a 100% discount is allowed and lands on zero", () => {
  const bill = calculateBill([{ name: "cake", quantity: 1, unitPrice: 150 }], pct("1 cake 100% off")!);
  assert.equal(bill.total, 0);
  assert.ok(bill.total >= 0, "the total can never go negative");
});
