import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, looksLikeOrderShape } from "../src/intent.js";
import { parseDiscount } from "../src/discount.js";

const name = (t: string) => classifyIntent(t).name;

// --- Discounting a bill that already exists -----------------------------
//
// "add a discount in the order 5 percent" was routed to add_item by the
// leading "add", and replied '"a" isn't a quantity'.
//
// No word list was needed to tell these apart, and none was added. The
// discount parser already finds the percentage; what it LEAVES BEHIND
// answers the rest:
//
//   remainder IS an order   -> bill it, with that discount
//   remainder is NOT        -> discount the bill already open

test("'add a discount in the order 5 percent' discounts the open bill", () => {
  assert.equal(name("add a discoint in the order 5 percent"), "set_discount");
  assert.equal(classifyIntent("add a discoint in the order 5 percent").amount, 5);
});

test("naming the customer still discounts, not adds", () => {
  assert.equal(name("add discount in tanishk order 10 percent"), "set_discount");
});

test("the short forms work", () => {
  for (const t of ["10 percent discount", "give 5% off on this bill", "20% off"]) {
    assert.equal(name(t), "set_discount", t);
  }
});

// --- An order with a discount is still an ORDER -------------------------

test("an order carrying a discount is billed, not treated as an edit", () => {
  assert.equal(name("dhruv 2 cakes 20 percent discount"), "order");
  assert.equal(name("ravi 2 paneer 1 chai 10% off"), "order");
});

test("the remainder is what decides it", () => {
  // This is the whole rule, stated directly.
  const withItems = parseDiscount("dhruv 2 cakes 20% off");
  assert.equal(withItems.percent, 20);
  assert.ok(looksLikeOrderShape(withItems.rest), "an order should remain");

  const withoutItems = parseDiscount("add a discount 5 percent");
  assert.equal(withoutItems.percent, 5);
  assert.ok(!looksLikeOrderShape(withoutItems.rest), "no order should remain");
});

// --- Nothing else is stolen ---------------------------------------------

test("adding an item is still adding an item", () => {
  assert.equal(name("add 2 chutney"), "add_item");
  assert.equal(name("add 2 chutney 15"), "add_item");
});

test("a message with no discount is untouched", () => {
  assert.equal(name("ravi 2 paneer"), "order");
  assert.equal(name("sales"), "sales");
  assert.equal(name("who hasn't paid"), "outstanding");
});

test("a percentage that is not a discount does not fire", () => {
  // Nothing here offers a percentage as anything else yet, but the parser
  // must not invent one from a bare number.
  assert.equal(parseDiscount("ravi 20 cakes").percent, null);
  assert.notEqual(name("ravi 20 cakes"), "set_discount");
});

test("a question about a discount does not apply one", () => {
  // The question guard covers state-changing intents; a discount is one.
  assert.notEqual(name("did i add 10 percent discount"), "set_discount");
});
