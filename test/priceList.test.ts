import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePriceList, readsAsPriceList } from "../src/priceList.js";

const entries = (t: string) => parsePriceList(t).entries;

// --- The bug that started this -----------------------------------------
// "/add 150 panner 20 lassi" was rejected wholesale: price-first AND two
// items on one line. Nothing saved, and the seller was told "Couldn't read".

test("price before the name, two items on one line", () => {
  assert.deepEqual(entries("150 panner 20 lassi"), [
    { name: "panner", price: 150 },
    { name: "lassi", price: 20 },
  ]);
});

test("name before the price, two items on one line", () => {
  assert.deepEqual(entries("panner 150 lassi 20"), [
    { name: "panner", price: 150 },
    { name: "lassi", price: 20 },
  ]);
});

// --- Shapes a seller actually types ------------------------------------

test("one item per line", () => {
  assert.deepEqual(entries("paneer 220\nlassi 80\nsamosa 20"), [
    { name: "paneer", price: 220 },
    { name: "lassi", price: 80 },
    { name: "samosa", price: 20 },
  ]);
});

test("comma separated", () => {
  assert.deepEqual(entries("paneer 220, lassi 80"), [
    { name: "paneer", price: 220 },
    { name: "lassi", price: 80 },
  ]);
});

test("price first, one per line", () => {
  assert.deepEqual(entries("220 paneer\n80 lassi"), [
    { name: "paneer", price: 220 },
    { name: "lassi", price: 80 },
  ]);
});

test("multi-word product names", () => {
  assert.deepEqual(entries("paneer butter masala 440 masala dosa 120"), [
    { name: "paneer butter masala", price: 440 },
    { name: "masala dosa", price: 120 },
  ]);
});

test("rupee symbol and rs prefix are stripped", () => {
  assert.deepEqual(entries("paneer ₹220\nlassi rs80\nchai rs.15"), [
    { name: "paneer", price: 220 },
    { name: "lassi", price: 80 },
    { name: "chai", price: 15 },
  ]);
});

test("decimal prices survive", () => {
  assert.deepEqual(entries("chai 15.50"), [{ name: "chai", price: 15.5 }]);
});

test("a single item still works", () => {
  assert.deepEqual(entries("paneer 120"), [{ name: "paneer", price: 120 }]);
});

// --- Product names containing digits must not be read as prices --------

test("'7up' is a name, not a price", () => {
  assert.deepEqual(entries("7up 40"), [{ name: "7up", price: 40 }]);
});

test("'500ml' stays part of the name", () => {
  assert.deepEqual(entries("thums up 500ml 40"), [
    { name: "thums up 500ml", price: 40 },
  ]);
});

// --- Failing safely -----------------------------------------------------

test("a name with no price is reported, not guessed", () => {
  const parsed = parsePriceList("paneer");
  assert.deepEqual(parsed.entries, []);
  assert.deepEqual(parsed.unreadable, ["paneer"]);
});

test("a good line still saves when another line is bad", () => {
  // Partial success matters: one unreadable line must never discard the
  // items that WERE understood.
  const parsed = parsePriceList("paneer 220\nlassi");
  assert.deepEqual(parsed.entries, [{ name: "paneer", price: 220 }]);
  assert.deepEqual(parsed.unreadable, ["lassi"]);
});

test("a dangling price on a line is reported", () => {
  const parsed = parsePriceList("paneer 220 lassi");
  assert.deepEqual(parsed.entries, [{ name: "paneer", price: 220 }]);
  assert.deepEqual(parsed.unreadable, ["lassi"]);
});

test("the same item twice keeps the last price", () => {
  assert.deepEqual(entries("paneer 220\npaneer 240"), [
    { name: "paneer", price: 240 },
  ]);
});

test("empty input yields nothing, not an error", () => {
  assert.deepEqual(parsePriceList("   \n  "), { entries: [], unreadable: [] });
});

test("free price is allowed", () => {
  assert.deepEqual(entries("water 0"), [{ name: "water", price: 0 }]);
});


// --- Rates or an order? ---------------------------------------------------
// readsAsPriceList runs in exactly one place: a seller whose price list is
// empty. Reading an order as rates would save a customer's name as a
// product; reading rates as an order loops them forever on "your price
// list is empty". Both are worse than asking, so it only answers when the
// shape is unambiguous.

test("name first, price last is a rate", () => {
  assert.ok(readsAsPriceList("paneer 220"));
  assert.ok(readsAsPriceList("full dabba 120"));
  assert.ok(readsAsPriceList("paneer 220, lassi 80"));
  assert.ok(readsAsPriceList("paneer 220\nlassi 80\nsamosa 20"));
});

test("quantity first is an order, never a rate", () => {
  // "2 paneer" as a rate would price paneer at ₹2 for every future bill.
  assert.equal(readsAsPriceList("2 paneer"), false);
  assert.equal(readsAsPriceList("150 panner"), false);
});

test("a customer name in front makes it an order", () => {
  assert.equal(readsAsPriceList("Ravi 2 paneer 220"), false);
  assert.equal(readsAsPriceList("Ravi 2 paneer 1 lassi"), false);
});

test("a bare name or a bare number is neither", () => {
  assert.equal(readsAsPriceList("paneer"), false);
  assert.equal(readsAsPriceList("220"), false);
  assert.equal(readsAsPriceList(""), false);
});

test("one bad line disqualifies the whole message", () => {
  // Partial acceptance here would save half a message the seller meant as
  // one thing, with no sign of which half.
  assert.equal(readsAsPriceList("paneer 220\n2 lassi"), false);
});

// --- A QUANTITY IS NOT A PRICE ------------------------------------------
//
// Reported. The seller sent, with /add on the last line:
//
//   3 thali 150
//   2 paneer 120
//   1 dal fry 90
//   4 roti 15
//   1 rice 80
//
// Every line was read price-first because it STARTS with a number, so
// thali saved at ₹3, dal fry at ₹1, rice at ₹1 — and the real prices were
// reported back as unreadable fragments called "150" and "90". It then
// offered to drop paneer from ₹100 to ₹2.
//
// Nothing here was near-missed or mis-modelled. It was arithmetic on the
// wrong number, which is the one failure a billing product cannot have.

test("the reported list saves the price, not the quantity", () => {
  const { entries, unreadable } = parsePriceList(
    "3 thali 150\n2 paneer 120\n1 dal fry 90\n4 roti 15\n1 rice 80",
  );
  assert.deepEqual(entries, [
    { name: "thali", price: 150 },
    { name: "paneer", price: 120 },
    { name: "dal fry", price: 90 },
    { name: "roti", price: 15 },
    { name: "rice", price: 80 },
  ]);
  assert.deepEqual(unreadable, [], "the real prices were thrown away as junk");
});

test("no saved price is ever a single-digit quantity from the line", () => {
  // The shape of the damage, stated directly: if the line contains a
  // bigger number, the small leading one is never the price.
  for (const [line, name, price] of [
    ["3 thali 150", "thali", 150],
    ["1 rice 80", "rice", 80],
    ["12 paneer roll 240", "paneer roll", 240],
  ] as [string, string, number][]) {
    assert.deepEqual(parsePriceList(line).entries, [{ name, price }], line);
  }
});

// --- The shape that must NOT change -------------------------------------

test("price-first still works when the line does not end in a number", () => {
  // "150 panner 20 lassi" is a real way to write a price list, and the
  // fix must not take the 150 for a quantity.
  assert.deepEqual(parsePriceList("150 panner 20 lassi").entries, [
    { name: "panner", price: 150 },
    { name: "lassi", price: 20 },
  ]);
});

test("name-first is untouched", () => {
  assert.deepEqual(parsePriceList("panner 150 lassi 20").entries, [
    { name: "panner", price: 150 },
    { name: "lassi", price: 20 },
  ]);
});

test("a plain two-token line is untouched", () => {
  assert.deepEqual(parsePriceList("paneer 220").entries, [{ name: "paneer", price: 220 }]);
  assert.deepEqual(parsePriceList("220 paneer").entries, [{ name: "paneer", price: 220 }]);
});

// --- EVERY NUMBER MUST BE ACCOUNTED FOR ---------------------------------
//
// The old parser saved from a line it had only half understood. That is
// how ₹3 thali got written while 150 sat in the same line unexplained.

test("a line with a number it cannot place saves NOTHING from that line", () => {
  const { entries, unreadable } = parsePriceList("paneer 220 30");
  assert.deepEqual(entries, [], "a half-understood money line was saved");
  assert.deepEqual(unreadable, ["paneer 220 30"]);
});

test("one bad line does not discard the good ones", () => {
  // Partial success across LINES stays — it is partial success WITHIN a
  // line that was dangerous.
  const { entries, unreadable } = parsePriceList("paneer 220\nchai 220 30\nlassi 80");
  assert.deepEqual(entries, [{ name: "paneer", price: 220 }, { name: "lassi", price: 80 }]);
  assert.deepEqual(unreadable, ["chai 220 30"]);
});

test("a leftover NAME is still safe, and still saves the rest", () => {
  // A name with no price cannot set a wrong price, so it is only a
  // question — not a reason to refuse the line.
  const { entries, unreadable } = parsePriceList("paneer 220 lassi");
  assert.deepEqual(entries, [{ name: "paneer", price: 220 }]);
  assert.deepEqual(unreadable, ["lassi"]);
});

test("a bare number never becomes a product", () => {
  for (const line of ["3 thali 150", "paneer 220 30", "150"]) {
    for (const e of parsePriceList(line).entries) {
      assert.ok(!/^\d+$/.test(e.name), `${line} produced a product named "${e.name}"`);
    }
  }
});
