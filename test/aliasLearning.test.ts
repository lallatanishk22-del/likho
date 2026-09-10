import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalogIndex, findCandidates, findProduct, type PriceCatalog } from "../src/catalog.js";
import { encodeMeant, decodeMeant } from "../src/messageHandler.js";
import { classifyIntent } from "../src/intent.js";

function catalog(...products: [string, number, string[]?][]): PriceCatalog {
  return {
    businessId: "b1",
    products: products.map(([name, price, aliases], i) => ({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      name,
      price,
      aliases: aliases ?? [],
    })),
  };
}

const names = (typed: string, cat: PriceCatalog) =>
  findCandidates(typed, buildCatalogIndex(cat)).map((p) => p.name);

// --- Offering the choice instead of a dead end -------------------------

test("an ambiguous name lists every product it could have meant", () => {
  assert.deepEqual(names("paner", catalog(["paneer", 100], ["panner", 200])), [
    "paneer",
    "panner",
  ]);
});

test("candidates exclude genuinely unrelated products", () => {
  const found = names("paner", catalog(["paneer", 100], ["panner", 200], ["biryani", 250]));
  assert.ok(!found.includes("biryani"));
});

test("candidates are ordered closest first", () => {
  // An exact match sorts ahead of a near one.
  assert.equal(names("paneer", catalog(["panner", 200], ["paneer", 100]))[0], "paneer");
});

// --- A learned alias removes the question entirely ---------------------

test("an alias makes the word an EXACT match, not a near one", () => {
  const cat = catalog(["paneer", 100, ["paner"]], ["panner", 200]);
  const found = findProduct("paner", buildCatalogIndex(cat));
  assert.notEqual(found, "ambiguous");
  assert.notEqual(found, null);
  assert.equal((found as { product: { name: string } }).product.name, "paneer");
  assert.equal((found as { kind: string }).kind, "exact");
});

test("without the alias the same word is ambiguous", () => {
  // Confirms the alias is what resolves it, not something else.
  const cat = catalog(["paneer", 100], ["panner", 200]);
  assert.equal(findProduct("paner", buildCatalogIndex(cat)), "ambiguous");
});

test("an alias does not affect other businesses' names", () => {
  // Aliases hang off a product, and a catalog belongs to one business.
  const cat = catalog(["paneer", 100, ["paner"]]);
  assert.equal(findProduct("biryani", buildCatalogIndex(cat)), null);
});

// --- Button encoding ---------------------------------------------------

test("a product choice round-trips through a button", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.equal(decodeMeant(encodeMeant(id)), id);
});

test("the choice carries an id, so a long product name cannot overflow", () => {
  const action = encodeMeant("00000000-0000-4000-8000-000000000001");
  assert.ok(Buffer.byteLength(action, "utf8") <= 64);
});

test("other actions are not decoded as a product choice", () => {
  assert.equal(decodeMeant("confirm:1042"), null);
  assert.equal(decodeMeant("merge:panner"), null);
});

test("a malformed id is rejected", () => {
  assert.equal(decodeMeant("meant:not-a-uuid"), null);
  assert.equal(decodeMeant("meant:"), null);
});

// --- Seeing and undoing what was taught --------------------------------

test("'what have you learned' shows the taught words", () => {
  assert.equal(classifyIntent("what have you learned").name, "learned");
});

test("'forget paner' removes one", () => {
  const intent = classifyIntent("forget paner");
  assert.equal(intent.name, "forget");
  assert.equal(intent.text, "paner");
});

test("'forget' does not swallow an order", () => {
  assert.equal(classifyIntent("2 paneer 1 chai").name, "order");
});
