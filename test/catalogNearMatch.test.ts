import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalogIndex, findProduct, resolvePrices, type PriceCatalog } from "../src/catalog.js";

function catalog(...products: [string, number][]): PriceCatalog {
  return {
    businessId: "b1",
    products: products.map(([name, price], i) => ({
      id: `p${i}`,
      name,
      price,
      aliases: [],
    })),
  };
}

function lookup(typed: string, cat: PriceCatalog) {
  const result = findProduct(typed, buildCatalogIndex(cat));
  if (result === null) return null;
  if (result === "ambiguous") return "ambiguous";
  return { name: result.product.name, kind: result.kind };
}

// --- The bug that started this -----------------------------------------

test("'lasssi' finds lassi", () => {
  assert.deepEqual(lookup("lasssi", catalog(["lassi", 80])), { name: "lassi", kind: "near" });
});

test("'panner' finds paneer", () => {
  assert.deepEqual(lookup("panner", catalog(["paneer", 220])), { name: "paneer", kind: "near" });
});

test("exact matches are still reported as exact", () => {
  assert.deepEqual(lookup("lassi", catalog(["lassi", 80])), { name: "lassi", kind: "exact" });
});

test("plurals still work", () => {
  assert.deepEqual(lookup("samosas", catalog(["samosa", 20])), { name: "samosa", kind: "exact" });
});

// --- Common real typo classes ------------------------------------------

test("doubled letters", () => {
  const cat = catalog(["roti", 15]);
  assert.deepEqual(lookup("rotti", cat), { name: "roti", kind: "near" });
});

test("missing repeated letter", () => {
  assert.deepEqual(lookup("dal", catalog(["daal", 90])), { name: "daal", kind: "near" });
});

test("transposed letters in a longer name", () => {
  assert.deepEqual(lookup("smaosa", catalog(["samosa", 20])), { name: "samosa", kind: "near" });
});

test("a typo inside a multi-word name", () => {
  assert.deepEqual(lookup("paneer buter masala", catalog(["paneer butter masala", 440])), {
    name: "paneer butter masala",
    kind: "near",
  });
});

// --- SAFETY: the failure that actually costs money ---------------------
// A wrong match puts the wrong price on a real bill. These are the tests
// that matter more than the ones above.

test("short names get no slack at all", () => {
  // "tea" and "sea" differ by one letter but are not typos of each other.
  assert.equal(lookup("sea", catalog(["tea", 15])), null);
});

test("two equally-close products refuse rather than pick one", () => {
  // "chai" is one letter from both. Guessing would be a coin toss on money.
  const result = lookup("chao", catalog(["chai", 15], ["chat", 60]));
  assert.equal(result, "ambiguous");
});

test("a genuinely different product is not matched", () => {
  assert.equal(lookup("biryani", catalog(["lassi", 80], ["paneer", 220])), null);
});

test("an exact match wins over a near match to something else", () => {
  // Both "panner" and "paneer" exist as separate items — the typed name
  // must win outright, not be corrected into the other one.
  assert.deepEqual(lookup("panner", catalog(["panner", 150], ["paneer", 220])), {
    name: "panner",
    kind: "exact",
  });
});

test("two letters wrong in a 7-letter name is not a typo", () => {
  assert.equal(lookup("bxryxni", catalog(["biryani", 250])), null);
});

test("a long name is allowed two slips", () => {
  // 11 letters has room for a genuine typo and little chance of
  // colliding with a different product.
  assert.deepEqual(lookup("rasmalaai", catalog(["rasmalai", 60])), {
    name: "rasmalai",
    kind: "near",
  });
});

test("a transposition costs one slip, not two", () => {
  // Plain Levenshtein scored this 2 and refused to bill it.
  assert.deepEqual(lookup("lassi chai", catalog(["lassi chai", 90])), {
    name: "lassi chai",
    kind: "exact",
  });
  assert.deepEqual(lookup("smaosa", catalog(["samosa", 20])), {
    name: "samosa",
    kind: "near",
  });
});

// --- The canonical name is what lands on the bill ----------------------

test("a near match bills under the catalog's own name", () => {
  const { resolved, unresolved } = resolvePrices(
    [{ name: "lasssi", quantity: 2, unitPrice: null, evidence: "2 lasssi" }],
    catalog(["lassi", 80]),
  );
  assert.equal(unresolved.length, 0);
  // Not "lasssi" — the seller sees "Lassi × 2" and can catch a wrong match
  // before confirming.
  assert.equal(resolved[0]!.name, "lassi");
  assert.equal(resolved[0]!.unitPrice, 80);
  assert.equal(resolved[0]!.priceSource, "catalog");
});

test("an unmatched item still asks instead of guessing", () => {
  const { resolved, unresolved } = resolvePrices(
    [{ name: "biryani", quantity: 1, unitPrice: null, evidence: "1 biryani" }],
    catalog(["lassi", 80]),
  );
  assert.equal(resolved.length, 0);
  assert.equal(unresolved[0]!.reason, "not_in_catalog");
});

test("a stated price bills an item that is not in the list at all", () => {
  const { resolved, unresolved } = resolvePrices(
    [{ name: "biryani", quantity: 1, unitPrice: 250, evidence: "1 biryani 250" }],
    catalog(["lassi", 80]),
  );
  assert.equal(unresolved.length, 0);
  assert.equal(resolved[0]!.unitPrice, 250);
  assert.equal(resolved[0]!.priceSource, "stated");
});

test("an empty catalog matches nothing", () => {
  assert.equal(lookup("lassi", catalog()), null);
});

// --- Spacing typos ------------------------------------------------------
// "rot i" is a normal phone typo. Edit distance handles it badly: the
// space counts as one edit AND shifts every following character.

test("'rot i' finds roti", () => {
  assert.deepEqual(lookup("rot i", catalog(["roti", 15])), { name: "roti", kind: "near" });
});

test("a missing space between words is found", () => {
  assert.deepEqual(lookup("paneerroll", catalog(["paneer roll", 120])), {
    name: "paneer roll",
    kind: "near",
  });
});

test("a stray space in a long name is found", () => {
  assert.deepEqual(lookup("masala do sa", catalog(["masala dosa", 120])), {
    name: "masala dosa",
    kind: "near",
  });
});

test("spacing does not override an exact match", () => {
  assert.deepEqual(lookup("roti", catalog(["roti", 15], ["rot i", 20])), {
    name: "roti",
    kind: "exact",
  });
});

test("two products that differ only by spacing refuse rather than guess", () => {
  assert.equal(lookup("hotdog", catalog(["hot dog", 80], ["hotd og", 90])), "ambiguous");
});

test("spacing does not match a genuinely different product", () => {
  assert.equal(lookup("bir yani", catalog(["roti", 15], ["chai", 10])), null);
});
