import { test } from "node:test";
import assert from "node:assert/strict";
import { leadingCustomerName } from "../src/leadingName.js";
import { parseOrderExtras } from "../src/orderExtras.js";

// "ravi 2 thali 150 1 dal 90"  -> the model found Ravi.
// "sana 2 thali 150 1 dal 90"  -> the model found nothing.
//
// Same sentence, same position. The model is guessing from how familiar
// the word looks, which is not a basis for a business record — and the
// seller is asked "who is this for?" on every bill whose customer has an
// uncommon name.

const SELLS = ["thali", "dal fry", "roti", "paneer tikka", "chai", "rose milk"];
// Mirrors the real predicate, which resolves a fragment ("rose") to the
// product it names ("rose milk") — see findProductByFragment.
const sells = (p: string) =>
  SELLS.some((s) => s === p || s.split(" ").includes(p));
const name = (t: string) => leadingCustomerName(t, sells);

test("the reported name is found by position", () => {
  assert.equal(name("sana 2 thali 150 1 dal 90 4 roti 15"), "Sana");
});

test("names the model already gets are unchanged", () => {
  assert.equal(name("ravi 2 chai 3 roti"), "Ravi");
  assert.equal(name("pooja\n3 thali 150"), "Pooja");
});

test("a two-word name survives", () => {
  assert.equal(name("ria bhanushali 2 thali"), "Ria Bhanushali");
});

test("ordering particles around the name are dropped", () => {
  assert.equal(name("Suresh ke liye 2 thali"), "Suresh");
  assert.equal(name("for ramesh 3 roti"), "Ramesh");
});

// --- What must NOT become a customer ------------------------------------

test("an order that opens with a product names nobody", () => {
  assert.equal(name("2 thali 1 dal fry"), null);
  assert.equal(name("thali 2"), null);
});

test("a date is not a customer", () => {
  assert.equal(name("aaj ke liye 2 thali"), null);
  assert.equal(name("kal 3 roti"), null);
});

test("a form of address alone is not a customer", () => {
  assert.equal(name("bhaiya 2 thali"), null);
  assert.equal(name("arey 2 roti"), null);
});

test("a product that could be a person's name stays a product", () => {
  // A seller who sells Rose Milk and has a customer called Rose: that is a
  // genuine ambiguity, and silence is the safe answer.
  assert.equal(name("rose milk 2"), null);
  assert.equal(name("rose 2 thali"), null);
});

test("a whole sentence is not a name", () => {
  assert.equal(name("can you please make me 2 thali"), null);
});

test("an empty or item-only message names nobody", () => {
  assert.equal(name(""), null);
  assert.equal(name("   "), null);
});

// --- The reported message, through the extractor -------------------------

test("'upi 970' is a payment with its amount, not an item", () => {
  // It matched nothing before: not a charge (upi is not a charge word),
  // not a note (it carries money), and the payment check required the line
  // to be a payment word ALONE. So it reached the extractor, which read
  // "... 4 roti 15 / upi 970" as "15 upi" — quantity fifteen of an item
  // called upi — and refused the whole order.
  const e = parseOrderExtras("sana 2 thali 150 1 dal 90 4 roti 15\nupi 970\nless oil\ndelivery included");
  assert.equal(e.paymentMethod, "UPI");
  assert.equal(e.advancePaid, 970);
  assert.equal(e.rest, "sana 2 thali 150 1 dal 90 4 roti 15");
  assert.deepEqual(e.notes.map((n) => n.category), ["prep", "delivery"]);
});

test("every shape of a stated payment", () => {
  for (const [line, mode, amount] of [
    ["upi 970", "UPI", 970],
    ["cash 500", "Cash", 500],
    ["970 by upi", "UPI", 970],
    ["paid 300 cash", "Cash", 300],
    ["gpay 250", "UPI", 250],
  ] as [string, string, number][]) {
    const e = parseOrderExtras(line);
    assert.equal(e.paymentMethod, mode, line);
    assert.equal(e.advancePaid, amount, line);
  }
});

test("an item line is never a payment", () => {
  for (const line of ["2 upi 40", "3 thali 150", "delivery 30"]) {
    assert.equal(parseOrderExtras(line).advancePaid, null, line);
  }
});

test("a payment word alone still sets only the method", () => {
  const e = parseOrderExtras("upi");
  assert.equal(e.paymentMethod, "UPI");
  assert.equal(e.advancePaid, null);
});
