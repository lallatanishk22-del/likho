import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOrder } from "../src/parser.js";
import { calculateBill } from "../src/calculator.js";
import { formatBill } from "../src/formatter.js";

test("parses a standard multi-line order", () => {
  const items = parseOrder("2 chicken biryani 450\n1 raita 80\n3 coke 40");
  assert.deepEqual(items, [
    { name: "chicken biryani", quantity: 2, unitPrice: 450 },
    { name: "raita", quantity: 1, unitPrice: 80 },
    { name: "coke", quantity: 3, unitPrice: 40 },
  ]);
});

test("supports the 'each' suffix on price", () => {
  const items = parseOrder("2 chicken biryani 450 each");
  assert.deepEqual(items, [{ name: "chicken biryani", quantity: 2, unitPrice: 450 }]);
});

test("ignores blank lines", () => {
  const items = parseOrder("2 coke 40\n\n1 raita 80\n");
  assert.equal(items.length, 2);
});

test("rejects a line with no price", () => {
  assert.throws(() => parseOrder("2 chicken biryani"));
});

test("rejects a line with zero quantity", () => {
  assert.throws(() => parseOrder("0 coke 40"));
});

test("calculateBill computes line totals and grand total", () => {
  const items = parseOrder("2 chicken biryani 450\n1 raita 80\n3 coke 40");
  const bill = calculateBill(items);
  assert.equal(bill.total, 1100);
  assert.equal(bill.lines[0]!.lineTotal, 900);
});

test("formatBill produces the expected layout", () => {
  const items = parseOrder("2 chicken biryani 450\n1 raita 80\n3 coke 40");
  const bill = calculateBill(items);
  const output = formatBill(bill);
  assert.match(output, /Chicken Biryani × 2/);
  assert.match(output, /₹900/);
  assert.match(output, /Total\s+₹1,100/);
});
