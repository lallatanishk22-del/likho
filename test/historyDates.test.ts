import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCustomerCandidate } from "../src/intent.js";
import { parseDateRange, stripDateExpressions } from "../src/businessDay.js";

const IST = "Asia/Kolkata";
const NOW = new Date("2026-09-12T09:30:00Z"); // 3:00pm IST, Sat 12 Sep

// Reads a message the way the handler does: strip the date, then take the
// name from what is left.
function read(text: string) {
  return {
    name: extractCustomerCandidate(stripDateExpressions(text)),
    period: parseDateRange(text, NOW, IST)?.label ?? null,
  };
}

// --- The message that failed in real use --------------------------------
// "bring me yesterday bill of tanishk" produced "What are the items in the
// bill?" — the date words leaked into the name, so "yesterday tanishk"
// matched no customer and it fell through to the order parser.

test("'bring me yesterday bill of tanishk' reads as a name AND a date", () => {
  assert.deepEqual(read("bring me yesterday bill of tanishk"), {
    name: "tanishk",
    period: "Yesterday",
  });
});

test("the date words never end up in the name", () => {
  for (const message of [
    "yesterday bill of tanishk",
    "tanishk bills today",
    "tanishk bills last week",
    "ravi bills this month",
  ]) {
    assert.ok(
      !/yesterday|today|week|month/i.test(read(message).name ?? ""),
      `${message} leaked a date word into the name: ${read(message).name}`,
    );
  }
});

test("a period is recognised alongside the name", () => {
  assert.equal(read("tanishk bills today").period, "Today");
  assert.equal(read("tanishk bills last week").period, "Last 7 days");
  assert.equal(read("ravi bills this month").period, "This month");
});

test("'last week' works, not just 'this week'", () => {
  // Previously only "this week" was recognised.
  assert.equal(parseDateRange("tanishk bills last week", NOW, IST)?.label, "Last 7 days");
  assert.equal(parseDateRange("tanishk bills past week", NOW, IST)?.label, "Last 7 days");
});

// --- A date carries digits; a quantity also carries digits -------------
// This is the distinction that keeps an order from being read as a history
// question. The date is REMOVED before the digit rule runs; the rule
// itself is never relaxed.

test("a named date does not make the message look like an order", () => {
  assert.equal(read("tanishk bills 10 sept").name, "tanishk");
  assert.equal(read("tanishk bills sept 10").name, "tanishk");
  assert.equal(read("tanishk bills 10/9").name, "tanishk");
});

test("a real quantity still makes it an order, even with a date present", () => {
  // The 2 survives the date strip, so the digit rule still fires and the
  // message goes to the order parser where it belongs.
  assert.equal(read("ria 2 chai today").name, null);
  assert.equal(read("tanishk 3 paneer yesterday").name, null);
  assert.equal(read("ravi 2 paneer 10 sept").name, null);
});

test("stripping a date leaves the rest of the message alone", () => {
  assert.equal(stripDateExpressions("ria 2 chai today"), "ria 2 chai");
  assert.equal(stripDateExpressions("tanishk bills 10 sept"), "tanishk bills");
  assert.equal(stripDateExpressions("no date here"), "no date here");
});

test("a message with no date has no period", () => {
  assert.equal(read("tanishk").period, null);
  assert.equal(read("bill of ria").period, null);
});

// --- Dates in the format India writes them -----------------------------

test("a numeric date is read day-first", () => {
  const r = parseDateRange("tanishk bills 8/9", NOW, IST)!;
  // 8 Sept, not 9 Aug.
  assert.equal(r.from.toISOString(), "2026-09-07T18:30:00.000Z");
});

test("'kal' is understood as yesterday", () => {
  assert.equal(read("tanishk ka kal ka bill").period, "Yesterday");
  assert.equal(read("tanishk ka kal ka bill").name, "tanishk");
});
