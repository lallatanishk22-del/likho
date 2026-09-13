import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePrices } from "../src/catalog.js";
import { parsePriceList } from "../src/priceList.js";
import { parseOrderExtras } from "../src/orderExtras.js";

// Five bugs found by auditing a day's work against itself. Every one was
// shipped, tested, and wrong — so each is pinned here by the behaviour
// that broke, not by the code that caused it.

const CAT = {
  businessId: "t",
  products: [
    { id: "1", name: "mango shake", price: 80, aliases: [] },
    { id: "2", name: "paneer tikka", price: 180, aliases: [] },
    { id: "3", name: "cheese sandwich", price: 60, aliases: [] },
    { id: "4", name: "cold coffee", price: 90, aliases: [] },
  ],
};
const billedAs = (name: string, unitPrice: number) =>
  resolvePrices([{ name, quantity: 1, unitPrice, evidence: "" }], CAT).resolved[0]?.name;

// --- 1. A loose name match renamed items the seller priced by hand -------
//
// Fragment matching shares only a WORD with the catalog entry. Applied to
// an item that already had a stated price, it put the wrong product on the
// customer's bill.

test("a new item priced by hand keeps the seller's name", () => {
  assert.equal(billedAs("mango juice", 60), "mango juice");
  assert.equal(billedAs("cold drink", 40), "cold drink");
  assert.equal(billedAs("paneer roll", 120), "paneer roll");
});

test("a loose match still resolves when the PRICE corroborates it", () => {
  // "woh cheese wala bhi 1 60 ka" — cheese sandwich costs exactly 60, so
  // two independent signals agree.
  assert.equal(billedAs("woh cheese wala bhi", 60), "cheese sandwich");
  assert.equal(billedAs("plate paneer tikka", 180), "paneer tikka");
});

test("the same reference at a DIFFERENT price is left alone", () => {
  assert.equal(billedAs("woh cheese wala bhi", 95), "woh cheese wala bhi");
});

test("a misspelling is still corrected, with no price agreement needed", () => {
  // An exact/near match is the same name spelled differently — one signal
  // is enough, and this must not regress into asking for corroboration.
  assert.equal(billedAs("paneer tika", 250), "paneer tikka");
});

// --- 2. The table-number strip was eating quantities --------------------

const sells = (p: string) => ["thali", "chai", "paneer tikka"].includes(p);

test("a quantity before a product is never stripped as a location", () => {
  // "kitchen 2 thali" became "thali" and billed ONE.
  assert.equal(parseOrderExtras("kitchen 2 thali", sells).rest, "kitchen 2 thali");
  assert.equal(parseOrderExtras("2 counter 40", sells).rest, "2 counter 40");
  assert.equal(parseOrderExtras("table 2 thali", sells).rest, "table 2 thali");
});

test("a real table number is still removed", () => {
  assert.equal(parseOrderExtras("room 12 me 3 chai bhejna", sells).rest, "me 3 chai bhejna");
  assert.equal(parseOrderExtras("table 4 ko 2 paneer tikka", sells).rest, "ko 2 paneer tikka");
});

// --- 3. Ingredient nouns were treated as preparation instructions -------

test("a product the seller has not priced yet is not swallowed as a note", () => {
  // "butter naan" and "masala chai" became prep NOTES and left the order.
  for (const line of ["butter naan", "masala chai", "fresh lime", "ghee roast"]) {
    assert.deepEqual(parseOrderExtras(line).notes, [], line);
    assert.equal(parseOrderExtras(line).rest, line, line);
  }
});

test("genuine preparation instructions still register", () => {
  for (const line of ["less oil", "no onion", "not too spicy", "bina pyaaz", "jain"]) {
    assert.equal(parseOrderExtras(line).notes[0]?.category, "prep", line);
  }
});

// --- 5. Rule A shifted every price on a longer line ----------------------

test("a three-run line drops its leading quantity", () => {
  assert.deepEqual(parsePriceList("3 thali 150").entries, [{ name: "thali", price: 150 }]);
});

test("a longer price-first line is REFUSED, not silently shifted", () => {
  // "150 panner 20 lassi 80" was saving panner=20 and lassi=80 — the 150
  // gone and every price moved one place along.
  const { entries, unreadable } = parsePriceList("150 panner 20 lassi 80");
  assert.deepEqual(entries, []);
  assert.deepEqual(unreadable, ["150 panner 20 lassi 80"]);
});

test("the price-first shapes that always worked still work", () => {
  assert.deepEqual(parsePriceList("150 panner 20 lassi").entries, [
    { name: "panner", price: 150 },
    { name: "lassi", price: 20 },
  ]);
  assert.deepEqual(parsePriceList("panner 150 lassi 20").entries, [
    { name: "panner", price: 150 },
    { name: "lassi", price: 20 },
  ]);
});
