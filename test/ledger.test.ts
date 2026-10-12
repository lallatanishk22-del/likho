import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLedger, type RawLedgerBill } from "../src/ledger.js";
import { ledgerAction, decodeLedgerAction } from "../src/ledgerReply.js";
import { parseDateRange } from "../src/businessDay.js";
import { renderLedger } from "../src/templates/ledger.js";

const bill = (no: number, total: number, paid: number, status = "draft"): RawLedgerBill => ({
  bill_no: no, created_at: "2026-10-12T05:00:00Z", customer_ref: "rahul", total, amount_paid: paid, status,
});

test("every bill counts, and Billed = Received + Due exactly", () => {
  const l = buildLedger("Today", [bill(1, 100, 100, "finalized"), bill(2, 250.5, 50), bill(3, 0.1, 0), bill(4, 0.2, 0)]);
  assert.equal(l.rows.length, 4);
  assert.equal(l.billed, 350.8);
  assert.equal(l.received, 150);
  assert.equal(l.due, 200.8);
  assert.equal(Math.round((l.received + l.due) * 100), Math.round(l.billed * 100));
  assert.equal(l.unconfirmedCount, 3);
  assert.deepEqual(l.rows.map((r) => r.status), ["Paid", "Part paid", "Unpaid", "Unpaid"]);
});

test("money beyond the bill is change, not a receipt", () => {
  const l = buildLedger("Today", [bill(1, 60, 100)]);
  assert.equal(l.received, 60);
  assert.equal(l.due, 0);
});

test("every period label the button carries reads back to the same period", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  for (const text of ["today", "yesterday", "this week sales", "last week sales", "last 7 days", "this month", "last month", "september sales", "14 sept"]) {
    const range = parseDateRange(text, now)!;
    const back = parseDateRange(range.label, now)!;
    assert.equal(back.from.getTime(), range.from.getTime(), text);
    assert.equal(back.to.getTime(), range.to.getTime(), text);
  }
});

test("button data fits Telegram's 64 bytes, even scoped to a customer", () => {
  const range = parseDateRange("september sales", new Date("2026-10-12T12:00:00Z"))!;
  const action = ledgerAction(range, "0a8a2b3c-1d2e-4f50-9a1b-2c3d4e5f6a7b");
  assert.ok(Buffer.byteLength(action) <= 64, action);
  const back = decodeLedgerAction(action)!;
  assert.equal(back.customerId, "0a8a2b3c-1d2e-4f50-9a1b-2c3d4e5f6a7b");
  assert.equal(decodeLedgerAction(ledgerAction(null))!.range, null);
});

test("the PDF has one row per bill and a totals row", () => {
  const html = renderLedger(buildLedger("Today", [bill(1, 100, 100, "finalized"), bill(2, 50, 0)]), "Sharma Store", null);
  assert.equal((html.match(/<tr>/g) ?? []).length, 1 + 2 + 1);
  assert.ok(html.includes("Sharma Store") && html.includes("Total") && html.includes("draft"));
});
