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
