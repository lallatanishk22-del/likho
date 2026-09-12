import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCustomerCandidate, classifyIntent } from "../src/intent.js";

const name = (t: string) => extractCustomerCandidate(t);

// --- The messages that actually failed in real use ----------------------
//
// The first version matched PHRASINGS ("ravi's bills", "history of ravi").
// A real seller typed none of those. Every line below fell through to the
// order parser, which then asked which items were on the order — a question
// with no answer — and looped on it.

test("'dude get me bill of ria' names ria", () => {
  assert.equal(name("dude get me bill of ria"), "ria");
});

test("'bill of ria' names ria", () => {
  assert.equal(name("bill of ria"), "ria");
});

test("'ria bill' names ria", () => {
  assert.equal(name("ria bill"), "ria");
});

test("'what about ravi' names ravi", () => {
  assert.equal(name("what about ravi"), "ravi");
});

test("'ravi ka bill' names ravi", () => {
  assert.equal(name("ravi ka bill"), "ravi");
});

test("'show me ria bill' names ria", () => {
  assert.equal(name("show me ria bill"), "ria");
});

test("'bhai ravi ka khata dikha' names ravi", () => {
  assert.equal(name("bhai ravi ka khata dikha"), "ravi");
});

test("'can you check ria's orders' names ria, without the possessive", () => {
  // The possessive must come off the NAME, not just off the filler test —
  // "ria's" has to be looked up as "ria".
  assert.equal(name("can you check ria's orders"), "ria");
});

test("'previous bill of ria' names ria", () => {
  assert.equal(name("previous bill of ria"), "ria");
});

test("a full name survives the stripping", () => {
  assert.equal(name("ria bhanushali bill"), "ria bhanushali");
  assert.equal(name("get me bill of ria bhanushali"), "ria bhanushali");
});

test("a bare name is returned unchanged", () => {
  assert.equal(name("ria"), "ria");
  assert.equal(name("ria bhanushali"), "ria bhanushali");
});

// --- An order is never mistaken for a question about one ---------------
// This is the guard that makes the whole approach safe: a message with a
// quantity in it is an order, full stop.

test("any message containing a digit is not a name", () => {
  for (const order of [
    "ria 2 paneer",
    "2 paneer 3 samosa",
    "ria bhanushali 2 paneer 1 chai",
    "bill of ria 2 chai",
    "#1042",
  ]) {
    assert.equal(name(order), null, order);
  }
});

test("a long message is not a name", () => {
  assert.equal(name("please send me the complete detailed statement for the whole month"), null);
});

test("an empty or punctuation-only message is not a name", () => {
  assert.equal(name(""), null);
  assert.equal(name("???"), null);
});

test("a message that is ALL filler names nobody", () => {
  assert.equal(name("get me the bill"), null);
  assert.equal(name("show me"), null);
});

// --- Nothing else is stolen --------------------------------------------
// Extraction only runs after every other intent has declined, and only
// produces history when the name matches a REAL customer. These confirm the
// earlier intents still win.

test("greetings, reports and commands never reach the name path", () => {
  assert.equal(classifyIntent("hi").name, "greeting");
  assert.equal(classifyIntent("sales").name, "sales");
  assert.equal(classifyIntent("who hasn't paid").name, "outstanding");
  assert.equal(classifyIntent("bill format").name, "bill_format");
  assert.equal(classifyIntent("open bills").name, "open_bills");
  assert.equal(classifyIntent("show #1042").name, "show_bill");
});

test("an order is still an order", () => {
  assert.equal(classifyIntent("ria bhanushali 2 paneer 1 chai").name, "order");
  assert.equal(classifyIntent("2 chai 3 samosa").name, "order");
});

test("a name that matches nobody falls through, losing nothing", () => {
  // extractCustomerCandidate only proposes; the caller checks the seller's
  // real customer list and falls back to the order parser when it misses.
  assert.equal(name("qwerty zxcvb"), "qwerty zxcvb");
  assert.equal(classifyIntent("qwerty zxcvb").name, "order");
});
