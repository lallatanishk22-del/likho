import { test } from "node:test";
import assert from "node:assert/strict";
import { startOfBusinessDay, isSameBusinessDay } from "../src/businessDay.js";

const IST = "Asia/Kolkata";

test("the business day starts at local midnight, not UTC midnight", () => {
  // 2026-09-10 09:00 IST == 2026-09-10 03:30 UTC
  const now = new Date("2026-09-10T03:30:00Z");
  // Local midnight IST is 2026-09-09T18:30:00Z.
  assert.equal(startOfBusinessDay(now, IST).toISOString(), "2026-09-09T18:30:00.000Z");
});

test("a 9am IST bill counts as today", () => {
  // The exact bug: on a UTC host this bill fell into "yesterday" and
  // disappeared from the seller's daily total.
  const now = new Date("2026-09-10T09:30:00Z"); // 3:00pm IST
  const billedAt = new Date("2026-09-10T03:33:00Z"); // 9:03am IST
  assert.equal(isSameBusinessDay(billedAt, now, IST), true);
});

test("a bill from just before midnight IST is yesterday", () => {
  const now = new Date("2026-09-10T09:30:00Z"); // 3:00pm IST on the 10th
  const billedAt = new Date("2026-09-09T18:29:00Z"); // 11:59pm IST on the 9th
  assert.equal(isSameBusinessDay(billedAt, now, IST), false);
});

test("a bill one minute after midnight IST is today", () => {
  const now = new Date("2026-09-10T09:30:00Z");
  const billedAt = new Date("2026-09-09T18:31:00Z"); // 12:01am IST on the 10th
  assert.equal(isSameBusinessDay(billedAt, now, IST), true);
});

test("the day boundary is a real instant, inclusive of its first moment", () => {
  const now = new Date("2026-09-10T09:30:00Z");
  const start = startOfBusinessDay(now, IST);
  assert.equal(isSameBusinessDay(start, now, IST), true);
  assert.equal(isSameBusinessDay(new Date(start.getTime() - 1), now, IST), false);
});

test("works for a timezone that observes DST", () => {
  // Sanity: the offset is derived, not hardcoded to +5:30.
  const summer = startOfBusinessDay(new Date("2026-07-01T12:00:00Z"), "America/New_York");
  const winter = startOfBusinessDay(new Date("2026-01-15T12:00:00Z"), "America/New_York");
  assert.equal(summer.toISOString(), "2026-07-01T04:00:00.000Z"); // EDT, UTC-4
  assert.equal(winter.toISOString(), "2026-01-15T05:00:00.000Z"); // EST, UTC-5
});

// --- Display in the business's timezone, never the server's -------------

import { formatBusinessDateTime, formatBusinessDate, parseDateRange } from "../src/businessDay.js";

test("a 9:03am IST bill displays as 9:03 am, not 3:33 am UTC", () => {
  const at = new Date("2026-09-10T03:33:00Z"); // 9:03am IST
  const shown = formatBusinessDateTime(at, IST);
  assert.match(shown, /10 Sept? 2026/);
  assert.match(shown, /9:03/);
  assert.match(shown, /am/i);
});

test("a late-evening IST bill keeps its own date, not the UTC one", () => {
  // 11:30pm IST on the 10th is 6:00pm UTC on the 10th — but 1am IST on the
  // 11th is 7:30pm UTC on the 10th, and must show the 11th.
  const at = new Date("2026-09-10T19:30:00Z"); // 1:00am IST on the 11th
  assert.match(formatBusinessDate(at, IST), /11 Sept? 2026/);
});

// --- Reporting periods --------------------------------------------------

const NOW = new Date("2026-09-10T09:30:00Z"); // 3:00pm IST, Thu 10 Sep

function range(text: string) {
  const r = parseDateRange(text, NOW, IST);
  if (!r) return null;
  return { label: r.label, from: r.from.toISOString(), to: r.to.toISOString() };
}

test("no period mentioned returns null so the caller defaults to today", () => {
  assert.equal(range("sales"), null);
});

test("'yesterday' is the previous business day", () => {
  assert.deepEqual(range("yesterday sales"), {
    label: "Yesterday",
    from: "2026-09-08T18:30:00.000Z", // midnight IST on the 9th
    to: "2026-09-09T18:30:00.000Z",
  });
});

test("'kal' is understood as yesterday", () => {
  assert.equal(parseDateRange("kal ka sales", NOW, IST)!.label, "Yesterday");
});

test("'today' is the current business day", () => {
  assert.deepEqual(range("today's sales"), {
    label: "Today",
    from: "2026-09-09T18:30:00.000Z",
    to: "2026-09-10T18:30:00.000Z",
  });
});

test("'this week' is the calendar week, Monday to today", () => {
  const r = parseDateRange("this week sales", NOW, IST)!;
  assert.equal(r.label, "This week");
  assert.equal(r.from.toISOString(), "2026-09-06T18:30:00.000Z"); // Mon 7 Sep IST
  assert.equal(r.to.toISOString(), "2026-09-10T18:30:00.000Z");
});

test("'last week' is the previous Monday to Sunday, not the last 7 days", () => {
  const r = parseDateRange("last week sales", NOW, IST)!;
  assert.equal(r.label, "Last week");
  assert.equal(r.from.toISOString(), "2026-08-30T18:30:00.000Z"); // Mon 31 Aug IST
  assert.equal(r.to.toISOString(), "2026-09-06T18:30:00.000Z"); // up to Mon 7 Sep
  assert.equal(parseDateRange("last 7 days", NOW, IST)!.label, "Last 7 days");
});

test("'this month' starts on the 1st", () => {
  const r = parseDateRange("this month sales", NOW, IST)!;
  assert.equal(r.from.toISOString(), "2026-08-31T18:30:00.000Z"); // 1 Sep IST
});

test("'last month' is the whole previous month", () => {
  const r = parseDateRange("last month sales", NOW, IST)!;
  assert.equal(r.from.toISOString(), "2026-07-31T18:30:00.000Z"); // 1 Aug IST
  assert.equal(r.to.toISOString(), "2026-08-31T18:30:00.000Z"); // 1 Sep IST
});

test("an explicit day works both ways round", () => {
  const a = parseDateRange("sales 8 sep", NOW, IST)!;
  const b = parseDateRange("sales sep 8", NOW, IST)!;
  assert.equal(a.from.toISOString(), "2026-09-07T18:30:00.000Z"); // 8 Sep IST
  assert.equal(a.from.toISOString(), b.from.toISOString());
});

test("a numeric date is read day-first, as India writes it", () => {
  const r = parseDateRange("sales 8/9", NOW, IST)!;
  assert.equal(r.from.toISOString(), "2026-09-07T18:30:00.000Z"); // 8 Sep, not 9 Aug
});

test("a date later this year means last year, not the future", () => {
  const r = parseDateRange("sales 25 dec", NOW, IST)!;
  assert.match(r.label, /2025/);
});

test("a full numeric date with year is respected", () => {
  const r = parseDateRange("sales 8/9/2025", NOW, IST)!;
  assert.match(r.label, /8 Sept? 2025/);
});

test("months, weeks, days and years further back, all reading back from their label", () => {
  const cases: [string, string, string, string][] = [
    // text, label, from (IST midnight as UTC), to
    ["2 months bill", "Last 2 months", "2026-07-31T18:30:00.000Z", "2026-09-10T18:30:00.000Z"],
    ["last 3 months", "Last 3 months", "2026-06-30T18:30:00.000Z", "2026-09-10T18:30:00.000Z"],
    ["last 14 days", "Last 14 days", "2026-08-27T18:30:00.000Z", "2026-09-10T18:30:00.000Z"],
    ["2 weeks", "Last 14 days", "2026-08-27T18:30:00.000Z", "2026-09-10T18:30:00.000Z"],
    ["this year", "This year", "2025-12-31T18:30:00.000Z", "2026-09-10T18:30:00.000Z"],
    ["last year", "Last year", "2024-12-31T18:30:00.000Z", "2025-12-31T18:30:00.000Z"],
    ["sales for 2025", "2025", "2024-12-31T18:30:00.000Z", "2025-12-31T18:30:00.000Z"],
  ];
  for (const [text, label, from, to] of cases) {
    const r = parseDateRange(text, NOW, IST)!;
    assert.equal(r.label, label, text);
    assert.equal(r.from.toISOString(), from, text);
    assert.equal(r.to.toISOString(), to, text);
    const back = parseDateRange(r.label, NOW, IST)!;
    assert.equal(back.from.getTime(), r.from.getTime(), `${text}: label must read back`);
  }
  assert.equal(parseDateRange("september 2026", NOW, IST)!.label, "September 2026");
});
