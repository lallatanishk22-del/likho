import { test } from "node:test";
import assert from "node:assert/strict";
import { auditPriceList } from "../src/priceListAudit.js";
import { suggestSpelling } from "../src/spellingSuggest.js";

// Every check here already existed — but only ran at /add time. A list
// built up over weeks, through a typo, a bad parse, and the same item
// entered twice, was never looked at again. The problems sat there
// printing onto customers' bills.

const LIVE = [
  { name: "10 chutney", price: 3 },
  { name: "10 icecream", price: 300 },
  { name: "bagel", price: 200 },
  { name: "cake", price: 150 },
  { name: "chai", price: 15 },
  { name: "lassi", price: 20 },
  { name: "mudpie", price: 100 },
  { name: "paneer", price: 100 },
  { name: "paneer roll", price: 120 },
  { name: "panner", price: 200 },
  { name: "rooti", price: 10 },
  { name: "samosa", price: 20 },
];

const kinds = (list = LIVE) => auditPriceList(list).map((p) => `${p.kind}:${p.name}`);

test("a name beginning with a number is reported as a bad entry", () => {
  // "10 chutney" at ₹3 is "chutney 10" read backwards, and would print on
  // a bill as "10 Chutney × 2" — nonsense to a customer.
  const found = auditPriceList(LIVE).find((p) => p.name === "10 chutney");
  assert.equal(found?.kind, "bad_name");
  assert.equal(found?.kind === "bad_name" ? found.suggested : null, "chutney");
});

test("a near-duplicate pair is reported", () => {
  const dup = auditPriceList(LIVE).find((p) => p.kind === "duplicate");
  assert.ok(dup, "paneer/panner was not reported");
  assert.ok(["paneer", "panner"].includes(dup!.name));
});

test("a duplicate pair is reported ONCE, not from both sides", () => {
  const dups = auditPriceList(LIVE).filter((p) => p.kind === "duplicate");
  assert.equal(dups.length, 1, "the same pair was reported twice");
});

test("a misspelling against the known-dish list is reported", () => {
  const found = auditPriceList(LIVE).find((p) => p.name === "rooti");
  assert.equal(found?.kind, "misspelling");
  assert.equal(found?.kind === "misspelling" ? found.suggested : null, "roti");
});

test("correctly spelled, unique items are left alone", () => {
  const reported = kinds().map((k) => k.split(":")[1]);
  for (const clean of ["bagel", "cake", "chai", "lassi", "samosa", "paneer roll"]) {
    assert.ok(!reported.includes(clean), `${clean} was wrongly flagged`);
  }
});

test("a clean list reports nothing", () => {
  assert.deepEqual(
    auditPriceList([
      { name: "paneer", price: 100 },
      { name: "chai", price: 15 },
      { name: "samosa", price: 20 },
    ]),
    [],
  );
});

test("an empty list reports nothing", () => {
  assert.deepEqual(auditPriceList([]), []);
});

// --- Which of a duplicate pair survives ---------------------------------
//
// The first version kept whichever had the higher price, which is
// arbitrary — and here actively wrong: it offered to keep "panner" over
// "paneer". The name PRINTS ON THE BILL, so spelling decides.

test("of a duplicate pair, the correctly spelled name is the one to keep", () => {
  // Mirrors the choice made when building the merge button.
  const a = "paneer", b = "panner";
  const aIsTypo = suggestSpelling(a) !== null;
  const bIsTypo = suggestSpelling(b) !== null;
  assert.equal(aIsTypo, false, "paneer should not read as a typo");
  assert.equal(bIsTypo, true, "panner should read as a typo");

  // TypeScript narrows these to literal booleans, so the choice is written
  // the way the handler writes it, against values it cannot fold away.
  const pick = (first: string, second: string): string => {
    const firstTypo = suggestSpelling(first) !== null;
    const secondTypo = suggestSpelling(second) !== null;
    return firstTypo !== secondTypo ? (firstTypo ? second : first) : first;
  };
  assert.equal(pick("paneer", "panner"), "paneer");
  assert.equal(pick("panner", "paneer"), "paneer", "the order of the pair must not matter");
});

test("when neither name is a typo, price breaks the tie", () => {
  // Two genuinely different spellings of an unknown dish: nothing in the
  // canonical list can judge them, so it falls back to the higher price.
  assert.equal(suggestSpelling("zunka"), null);
  assert.equal(suggestSpelling("zunkaa"), null);
});

test("a bad name is reported before anything else about it", () => {
  // "10 chutney" must not also be offered as a misspelling of something.
  const forChutney = auditPriceList(LIVE).filter((p) => p.name === "10 chutney");
  assert.equal(forChutney.length, 1);
});
