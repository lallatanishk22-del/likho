import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePriceList } from "../src/priceList.js";

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
