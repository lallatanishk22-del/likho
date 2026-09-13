import { test } from "node:test";
import assert from "node:assert/strict";
import { unusedNumbers } from "../src/unusedNumbers.js";

// The worst failure a billing product has is not a wrong answer — those
// get argued about and corrected — it is a QUIET one. "home delivery 50"
// vanished from a bill that looked complete, and nothing said so.

const REPORTED = "pooja\n3 thali 150\n2 paneer 120\n1 dal fry 90\n4 roti 15\n1 rice 80\nless spicy\nhome delivery 50\ntotal batao";

test("the dropped charge is reported when nothing accounts for it", () => {
  assert.deepEqual(
    unusedNumbers(REPORTED, {
      quantities: [3, 2, 1, 4, 1],
      unitPrices: [150, 120, 90, 15, 80],
      chargeAmounts: [],
      discountPercent: null,
    }),
    [50],
  );
});

test("once the charge IS parsed, nothing is reported", () => {
  assert.deepEqual(
    unusedNumbers(REPORTED, {
      quantities: [3, 2, 1, 4, 1],
      unitPrices: [150, 120, 90, 15, 80],
      chargeAmounts: [50],
      discountPercent: null,
    }),
    [],
  );
});

// --- It must stay quiet on ordinary bills -------------------------------
// A note that fires on every bill is a note the seller stops reading.

test("a plain order reports nothing", () => {
  assert.deepEqual(
    unusedNumbers("ravi 2 paneer 220 3 chai 15", {
      quantities: [2, 3], unitPrices: [220, 15], chargeAmounts: [], discountPercent: null,
    }),
    [],
  );
});

test("a line total the seller worked out themselves is not a stray number", () => {
  // "2 chai 15 30" — they wrote the line total too.
  assert.deepEqual(
    unusedNumbers("2 chai 15 30", {
      quantities: [2], unitPrices: [15], chargeAmounts: [], discountPercent: null,
    }),
    [],
  );
});

test("a stated discount is accounted for", () => {
  assert.deepEqual(
    unusedNumbers("2 cake 150 10% off", {
      quantities: [2], unitPrices: [150], chargeAmounts: [], discountPercent: 10,
    }),
    [],
  );
});

test("a bill reference is not money", () => {
  assert.deepEqual(
    unusedNumbers("#1042 2 chai 15", {
      quantities: [2], unitPrices: [15], chargeAmounts: [], discountPercent: null,
    }),
    [],
  );
});

test("duplicates are collapsed and order is kept", () => {
  assert.deepEqual(
    unusedNumbers("2 chai 15 plus 50 and 50 and 70", {
      quantities: [2], unitPrices: [15], chargeAmounts: [], discountPercent: null,
    }),
    [50, 70],
  );
});

test("a message with no numbers at all reports nothing", () => {
  assert.deepEqual(
    unusedNumbers("less spicy please", {
      quantities: [1], unitPrices: [50], chargeAmounts: [], discountPercent: null,
    }),
    [],
  );
});
