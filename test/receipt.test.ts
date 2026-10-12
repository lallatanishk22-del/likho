import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutReceipt, RECEIPT_WIDTH, type ReceiptInput } from "../src/chatFormat.js";

const base: ReceiptInput = {
  billNo: 1041,
  customer: "Rahul",
  stamp: "12 Oct 2026, 5:05 pm",
  items: [
    { name: "Paneer Tikka", qty: 2, amount: "₹360" },
    { name: "Butter Naan", qty: 3, amount: "₹120" },
  ],
  summary: [
    { left: "Subtotal", right: "₹480" },
    { left: "Discount 10%", right: "−₹48" },
  ],
  total: "₹432",
  payment: "Paid ₹200 · Due ₹232",
};

const tableLines = (lines: string[]) => lines.filter((l) => /₹/.test(l) && !l.trim().startsWith("Paid"));

test("every line fits the phone width", () => {
  for (const line of layoutReceipt(base)) assert.ok(line.length <= RECEIPT_WIDTH, `too wide: "${line}"`);
});

test("every amount ends on the right edge", () => {
  for (const line of tableLines(layoutReceipt(base))) assert.equal(line.length, RECEIPT_WIDTH, line);
});

test("huge amounts and quantities shrink the name column, never the money", () => {
  const big = layoutReceipt({
    ...base,
    items: [{ name: "Gold Coin Special Edition", qty: 100000, amount: "₹1,00,00,000" }],
    summary: [],
    total: "₹1,00,00,000",
  });
  for (const line of big) assert.ok(line.length <= RECEIPT_WIDTH, `too wide: "${line}"`);
  const row = big.find((l) => l.includes("100000"))!;
  assert.ok(row.endsWith("₹1,00,00,000") && row.includes("…"), row);
});

test("no customer, no discount: still a complete receipt", () => {
  const lines = layoutReceipt({ ...base, customer: null, summary: [] });
  assert.equal(lines[0]!.trim(), "Bill #1041");
  assert.ok(lines.some((l) => l.startsWith("TOTAL") && l.endsWith("₹432")));
});
