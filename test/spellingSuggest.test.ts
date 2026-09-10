import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestSpelling } from "../src/spellingSuggest.js";
import { suggestFromList } from "../src/nearName.js";

const suggest = (name: string) => suggestSpelling(name)?.suggested ?? null;

// --- The case that started this ----------------------------------------
// The seller saved "panner" into their own price list. It matched fine
// when billing, but "Panner x 5" prints on every customer's bill.

test("'panner' suggests 'paneer'", () => {
  assert.equal(suggest("panner"), "paneer");
});

test("'panner butter masala' suggests the canonical spelling", () => {
  assert.equal(suggest("panner butter masala"), "paneer butter masala");
});

// --- Common misspellings in this segment -------------------------------

test("doubled letters", () => {
  assert.equal(suggest("lasssi"), "lassi");
  assert.equal(suggest("rotti"), "roti");
});

test("dropped letters", () => {
  assert.equal(suggest("samosa"), null); // already correct
  assert.equal(suggest("smaosa"), "samosa");
});

test("transposed letters", () => {
  assert.equal(suggest("brownei"), "brownie");
});

// --- SAFETY: never overrule a correct or deliberate name ---------------

test("a correctly spelled item suggests nothing", () => {
  for (const name of ["paneer", "samosa", "chai", "lassi", "masala dosa"]) {
    assert.equal(suggest(name), null, `${name} should need no correction`);
  }
});

test("an unknown dish is left alone, not corrected into something else", () => {
  // Not in the list and not close to anything — the seller's own item.
  assert.equal(suggest("thecha bhakri"), null);
  assert.equal(suggest("zunka"), null);
});

test("a short name is never corrected", () => {
  // At three letters, one wrong letter is a different product.
  assert.equal(suggest("tea"), null);
  assert.equal(suggest("pav"), null);
});

test("a name equally close to two canonical items suggests nothing", () => {
  // A tie is a genuine ambiguity, not a coin toss.
  assert.equal(suggestFromList("chai", ["chat", "chao"]), null);
});

test("case and spacing do not trigger a suggestion", () => {
  assert.equal(suggest("Paneer"), null);
  assert.equal(suggest("  paneer  "), null);
});

test("an empty name suggests nothing", () => {
  assert.equal(suggest(""), null);
});

// --- The shared matcher used by both callers ---------------------------

test("an exact member of the list is not a typo of itself", () => {
  assert.equal(suggestFromList("paneer", ["paneer", "panner"]), null);
});

test("a unique near match wins", () => {
  assert.equal(suggestFromList("panner", ["paneer", "samosa"]), "paneer");
});

test("nothing close enough returns null", () => {
  assert.equal(suggestFromList("biryani", ["paneer", "samosa"]), null);
});

// --- One-tap fix encoding ----------------------------------------------
// Telegram caps callback_data at 64 BYTES.

import { encodeFix, decodeFix } from "../src/messageHandler.js";

test("a normal rename round-trips through a button", () => {
  const action = encodeFix("panner", "paneer")!;
  assert.deepEqual(decodeFix(action), { from: "panner", to: "paneer" });
});

test("multi-word names round-trip", () => {
  const action = encodeFix("panner butter masala", "paneer butter masala")!;
  assert.deepEqual(decodeFix(action), {
    from: "panner butter masala",
    to: "paneer butter masala",
  });
});

test("names too long for a button return null rather than truncating", () => {
  // A truncated name would rename the WRONG product. No button is offered
  // and the seller gets the typed command instead.
  const long = "a".repeat(40);
  assert.equal(encodeFix(long, long), null);
});

test("the encoded action fits Telegram's 64-byte cap", () => {
  const action = encodeFix("panner butter masala", "paneer butter masala")!;
  assert.ok(Buffer.byteLength(action, "utf8") <= 64);
});

test("a non-fix action is not decoded as one", () => {
  assert.equal(decodeFix("confirm:1042"), null);
});

test("a malformed fix action is rejected", () => {
  assert.equal(decodeFix("fix:paneer"), null);
});
