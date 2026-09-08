import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateBill } from "../src/calculator.js";
import { formatBill } from "../src/formatter.js";

// Money correctness is the core promise of a billing product. These lock in
// three real bugs found by probing the calculator with realistic input.

// ── Basic arithmetic ─────────────────────────────────────────────────

test("computes line totals, subtotal and total", () => {
  const bill = calculateBill([
    { name: "paneer", quantity: 2, unitPrice: 120 },
    { name: "samosa", quantity: 3, unitPrice: 20 },
  ]);
  assert.equal(bill.lines[0]!.lineTotal, 240);
  assert.equal(bill.lines[1]!.lineTotal, 60);
  assert.equal(bill.subtotal, 300);
  assert.equal(bill.total, 300);
});

test("an empty order totals zero rather than NaN", () => {
  const bill = calculateBill([]);
  assert.equal(bill.subtotal, 0);
  assert.equal(bill.total, 0);
});

// ── BUG 1: binary float drift reaching the bill ──────────────────────

test("REGRESSION: 0.1 + 0.2 must be 0.3, not 0.30000000000000004", () => {
  const bill = calculateBill([
    { name: "a", quantity: 1, unitPrice: 0.1 },
    { name: "b", quantity: 1, unitPrice: 0.2 },
  ]);
  assert.equal(bill.subtotal, 0.3);
  assert.equal(bill.total, 0.3);
});

test("REGRESSION: fractional prices accumulate to exact paise", () => {
  const bill = calculateBill([
    { name: "chai", quantity: 3, unitPrice: 12.5 },
    { name: "samosa", quantity: 7, unitPrice: 8.1 },
    { name: "biscuit", quantity: 3, unitPrice: 5.3 },
  ]);
  assert.equal(bill.lines[0]!.lineTotal, 37.5);
  assert.equal(bill.lines[1]!.lineTotal, 56.7);
  assert.equal(bill.lines[2]!.lineTotal, 15.9);
  assert.equal(bill.subtotal, 110.1);
});

test("every computed amount is a whole number of paise", () => {
  const bill = calculateBill(
    [{ name: "x", quantity: 7, unitPrice: 33.33 }],
    17,
  );
  // NB: verify via toFixed, not `amount * 100` — that multiplication is
  // itself float math (39.66 * 100 === 3965.9999999999995) and would fail
  // on values that are genuinely exact.
  for (const amount of [bill.subtotal, bill.discountAmount, bill.total, bill.lines[0]!.lineTotal]) {
    assert.equal(Number(amount.toFixed(2)), amount, `${amount} has sub-paise precision`);
  }
});

// ── BUG 2: a discount over 100% produced a NEGATIVE bill ─────────────

test("REGRESSION: >100% discount clamps to zero, never a negative total", () => {
  const bill = calculateBill([{ name: "x", quantity: 1, unitPrice: 500 }], 150);
  assert.equal(bill.total, 0, "a bill must never be negative");
  assert.equal(bill.discountAmount, 500, "discount cannot exceed the subtotal");
});

test("exactly 100% discount totals zero", () => {
  const bill = calculateBill([{ name: "x", quantity: 1, unitPrice: 500 }], 100);
  assert.equal(bill.total, 0);
});

// ── BUG 3: a negative discount silently INCREASED the bill ───────────

test("REGRESSION: a negative discount cannot inflate the total", () => {
  const bill = calculateBill([{ name: "x", quantity: 1, unitPrice: 500 }], -10);
  assert.equal(bill.total, 500, "total must not exceed subtotal");
  assert.equal(bill.discountAmount, 0);
  assert.equal(bill.discountPercent, 0);
});

// ── Discounts, normal cases ──────────────────────────────────────────

test("applies a percentage discount", () => {
  const bill = calculateBill([{ name: "x", quantity: 1, unitPrice: 1000 }], 10);
  assert.equal(bill.discountAmount, 100);
  assert.equal(bill.total, 900);
});

test("a fractional discount stays exact to the paise", () => {
  const bill = calculateBill([{ name: "x", quantity: 1, unitPrice: 255 }], 10);
  assert.equal(bill.discountAmount, 25.5);
  assert.equal(bill.total, 229.5);
});

test("the total always equals subtotal minus discount", () => {
  for (const pct of [0, 5, 10, 33, 50, 99, 100]) {
    const bill = calculateBill(
      [
        { name: "a", quantity: 3, unitPrice: 12.5 },
        { name: "b", quantity: 2, unitPrice: 99.99 },
      ],
      pct,
    );
    assert.equal(
      bill.total,
      Math.round((bill.subtotal - bill.discountAmount) * 100) / 100,
      `mismatch at ${pct}%`,
    );
    assert.ok(bill.total >= 0, `negative total at ${pct}%`);
    assert.ok(bill.total <= bill.subtotal, `total exceeds subtotal at ${pct}%`);
  }
});

// ── Display ──────────────────────────────────────────────────────────

test("REGRESSION: paise always render as two digits, not one", () => {
  const bill = calculateBill([{ name: "chai", quantity: 3, unitPrice: 12.5 }]);
  const output = formatBill(bill);
  assert.match(output, /₹37\.50/, "must show ₹37.50, not ₹37.5");
  assert.doesNotMatch(output, /₹37\.5(?!0)/);
});

test("whole rupees render without decimals", () => {
  const bill = calculateBill([{ name: "paneer", quantity: 2, unitPrice: 120 }]);
  assert.match(formatBill(bill), /₹240(?!\.)/);
});

test("large amounts use Indian comma grouping", () => {
  const bill = calculateBill([{ name: "x", quantity: 2, unitPrice: 450 }]);
  assert.match(formatBill(bill), /₹900/);
  const big = calculateBill([{ name: "x", quantity: 1000, unitPrice: 999 }]);
  assert.match(formatBill(big), /₹9,99,000/);
});
