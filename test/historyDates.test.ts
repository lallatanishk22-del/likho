import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDateRange, stripDateExpressions } from "../src/businessDay.js";

const IST = "Asia/Kolkata";
const NOW = new Date("2026-09-12T09:30:00Z"); // 3:00pm IST, Sat 12 Sep

// --- A date carries digits; so does a quantity --------------------------
//
// A digit is what tells an ORDER from a question about one, so the digit
// rule can never be relaxed. Instead the date is REMOVED first and the rule
// then runs unchanged on what is left. These tests pin that separation.

test("removing a date leaves no digits behind", () => {
  for (const message of [
    "tanishk bills 10 sept",
    "tanishk bills sept 10",
    "tanishk bills 10/9",
    "tanishk bills 10/9/2025",
    "ravi bills last 7 days",
  ]) {
    assert.ok(
      !/\d/.test(stripDateExpressions(message)),
      `${message} -> ${stripDateExpressions(message)} still has a digit`,
    );
  }
});

test("a real quantity survives the date strip, so it stays an order", () => {
  assert.equal(stripDateExpressions("ria 2 chai today"), "ria 2 chai");
  assert.equal(stripDateExpressions("tanishk 3 paneer yesterday"), "tanishk 3 paneer");
  assert.equal(stripDateExpressions("ravi 2 paneer 10 sept"), "ravi 2 paneer");
});

test("a message with no date is returned untouched", () => {
  assert.equal(stripDateExpressions("no date here"), "no date here");
  assert.equal(stripDateExpressions("bill of ria"), "bill of ria");
});

test("word dates are removed", () => {
  for (const word of ["yesterday", "today", "kal", "aaj", "this week", "last month"]) {
    const stripped = stripDateExpressions(`ravi bills ${word}`);
    assert.equal(stripped, "ravi bills", `"${word}" survived as "${stripped}"`);
  }
});

// --- Periods a seller actually asks for --------------------------------

test("'yesterday' and 'kal' both mean yesterday", () => {
  assert.equal(parseDateRange("yesterday bill of tanishk", NOW, IST)?.label, "Yesterday");
  assert.equal(parseDateRange("tanishk ka kal ka bill", NOW, IST)?.label, "Yesterday");
});

test("'last week' resolves, not just 'this week'", () => {
  // Previously only "this week" was recognised.
  assert.equal(parseDateRange("tanishk bills last week", NOW, IST)?.label, "Last 7 days");
  assert.equal(parseDateRange("tanishk bills past week", NOW, IST)?.label, "Last 7 days");
  assert.equal(parseDateRange("tanishk bills this week", NOW, IST)?.label, "Last 7 days");
});

test("'this month' and 'last month' resolve", () => {
  assert.equal(parseDateRange("ravi bills this month", NOW, IST)?.label, "This month");
  assert.equal(parseDateRange("ravi bills last month", NOW, IST)?.label, "Last month");
});

test("a named day resolves, written either way round", () => {
  const a = parseDateRange("tanishk bills 10 sept", NOW, IST)!;
  const b = parseDateRange("tanishk bills sept 10", NOW, IST)!;
  assert.equal(a.from.toISOString(), b.from.toISOString());
});

test("a numeric date is read day-first, as India writes it", () => {
  const r = parseDateRange("tanishk bills 8/9", NOW, IST)!;
  // 8 September, never 9 August.
  assert.equal(r.from.toISOString(), "2026-09-07T18:30:00.000Z");
});

test("no date mentioned means no period, so history covers everything", () => {
  assert.equal(parseDateRange("tanishk", NOW, IST), null);
  assert.equal(parseDateRange("can you get me bills total of ravi", NOW, IST), null);
  assert.equal(parseDateRange("how much has ravi spent till date", NOW, IST), null);
});
