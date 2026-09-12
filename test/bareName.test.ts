import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalogIndex, findProduct, type PriceCatalog } from "../src/catalog.js";
import { suggestSpelling } from "../src/spellingSuggest.js";
import { parsePriceList } from "../src/priceList.js";

// "/add paner" came back "I couldn't find a price for: paner" — true, and
// useless. The seller already HAS paneer at ₹100, and that is the one
// thing worth saying.
//
// A NAME WITH NO PRICE IS NOT A FAILURE. It is a question, and the price
// list can answer it.

const catalog: PriceCatalog = {
  businessId: "b1",
  products: [
    { id: "p1", name: "paneer", price: 100, aliases: [] },
    { id: "p2", name: "chai", price: 15, aliases: [] },
  ],
};
const index = buildCatalogIndex(catalog);

const owned = (name: string) => {
  const found = findProduct(name, index);
  return found && found !== "ambiguous" ? found.product.name : null;
};

test("a bare name with no price is reported as unreadable, not saved", () => {
  // The parser must not invent a price for it.
  const parsed = parsePriceList("paner");
  assert.deepEqual(parsed.entries, []);
  assert.deepEqual(parsed.unreadable, ["paner"]);
});

test("a misspelling of something they already have is recognised", () => {
  assert.equal(owned("paner"), "paneer");
});

test("the exact name they already have is recognised", () => {
  assert.equal(owned("paneer"), "paneer");
});

test("a dish they do not have is not claimed to exist", () => {
  assert.equal(owned("rooti"), null);
  assert.equal(owned("thecha"), null);
});

test("a dish they do not have but is a known misspelling gets the spelling", () => {
  // Offered BEFORE it is saved wrong and starts printing on bills.
  assert.equal(suggestSpelling("rooti")?.suggested, "roti");
});

test("an unknown dish gets no invented suggestion", () => {
  // "thecha" is real, not in the canonical list, and must be left alone.
  assert.equal(suggestSpelling("thecha"), null);
});

test("a name with a price still saves normally", () => {
  const parsed = parsePriceList("paner 120");
  assert.deepEqual(parsed.entries, [{ name: "paner", price: 120 }]);
  assert.deepEqual(parsed.unreadable, []);
});

test("several bare names are each answered", () => {
  const parsed = parsePriceList("paner\nrooti\nthecha");
  assert.deepEqual(parsed.entries, []);
  assert.deepEqual(parsed.unreadable, ["paner", "rooti", "thecha"]);
});

test("a good line still saves when a bare name sits beside it", () => {
  const parsed = parsePriceList("samosa 20\npaner");
  assert.deepEqual(parsed.entries, [{ name: "samosa", price: 20 }]);
  assert.deepEqual(parsed.unreadable, ["paner"]);
});
