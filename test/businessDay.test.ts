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
