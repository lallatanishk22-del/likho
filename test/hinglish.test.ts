import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalogIndex, findProductByContainment, resolvePrices } from "../src/catalog.js";
import { expandHindiNumerals, hasNumeralWord, isNumeralWord } from "../src/hindiNumerals.js";
import { parseOrderExtras } from "../src/orderExtras.js";

// Likho's promise is "send me the order, I'll make the bill". A tiffin
// seller in Pune does not type "2 paneer tikka 180". They type "Suresh
// bhaiya ko do plate paneer tikka bhej do". The live eval (eval/hinglish.ts)
// went 13/26 -> 26/26 on the rules pinned here.
//
// THE RULE BEHIND ALL OF IT: never a list of Hindi words. Filler is
// open-ended and every attempt to enumerate it has broken on the next word
// a real person typed. The seller's own price list is the ground truth.

const catalog = {
  businessId: "test",
  products: [
    { id: "1", name: "paneer tikka", price: 180, aliases: [] },
    { id: "2", name: "butter naan", price: 40, aliases: [] },
    { id: "3", name: "coke", price: 40, aliases: [] },
    { id: "4", name: "chai", price: 15, aliases: [] },
    { id: "5", name: "paneer roll", price: 120, aliases: [] },
    { id: "6", name: "lassi", price: 20, aliases: [] },
  ],
};
const index = buildCatalogIndex(catalog);
const inside = (name: string) => {
  const r = findProductByContainment(name, index);
  return r === null || r === "ambiguous" ? r : r.product.name;
};

// --- A product wrapped in words the seller's list has never heard of ----

test("a container word around a real product resolves to the product", () => {
  assert.equal(inside("plate paneer tikka"), "paneer tikka");
  assert.equal(inside("glass lassi"), "lassi");
  assert.equal(inside("dabba paneer roll"), "paneer roll");
});

test("an adjective around a real product resolves to the product", () => {
  assert.equal(inside("thanda coke"), "coke");
  assert.equal(inside("garam butter naan"), "butter naan");
  assert.equal(inside("extra spicy paneer tikka"), "paneer tikka");
});

test("it works for languages nobody listed anywhere", () => {
  // The point of using the catalog instead of a word list: these were
  // never considered, and they work for free.
  assert.equal(inside("sada chai"), "chai");
  assert.equal(inside("1 large cold coke"), "coke");
  assert.equal(inside("chhota lassi glass"), "lassi");
});

// --- The discipline that keeps it safe ----------------------------------

test("the LONGEST match wins, so a variant never collapses to its base", () => {
  // "paneer roll" must never be billed as "paneer tikka" or vice versa.
  assert.equal(inside("ek plate paneer roll"), "paneer roll");
  assert.equal(inside("garam paneer tikka plate"), "paneer tikka");
});

test("two different products inside one name is a refusal, not a guess", () => {
  assert.equal(inside("paneer tikka butter naan"), "ambiguous");
});

test("a misspelling inside a wrapped phrase still resolves", () => {
  // Containment runs the full tiered lookup, so near-matching still applies.
  assert.equal(inside("plate panner tikka"), "paneer tikka");
});

test("a name with nothing of the seller's in it stays unresolved", () => {
  assert.equal(inside("mutton biryani"), null);
  assert.equal(inside("garam dosa"), null);
});

test("a single token is left to the normal lookup", () => {
  // Containment is about a product sitting INSIDE a longer phrase.
  assert.equal(inside("coke"), null);
});

test("digits are never taken for a product", () => {
  assert.equal(inside("12 34"), null);
});

test("containment actually prices the item, at the catalog price", () => {
  const { resolved, unresolved } = resolvePrices(
    [{ name: "2 plate paneer tikka".replace(/^2 /, ""), quantity: 2, unitPrice: null, evidence: "2 plate paneer tikka" }],
    catalog,
  );
  assert.deepEqual(unresolved, []);
  assert.equal(resolved[0]!.name, "paneer tikka", "the CANONICAL name must print on the bill");
  assert.equal(resolved[0]!.unitPrice, 180);
  assert.equal(resolved[0]!.priceSource, "catalog");
});

// --- Quantities written as words ----------------------------------------
//
// A numeral system is CLOSED and finite, unlike filler. That is the only
// reason this list is allowed to exist.

const sells = (phrase: string) => {
  const r = findProductByContainment(phrase, index);
  const direct = catalog.products.some((p) => p.name === phrase.toLowerCase());
  return direct || (r !== null && r !== "ambiguous");
};
const expand = (t: string) => expandHindiNumerals(t, sells);

test("a Hindi numeral before a product becomes a digit", () => {
  assert.equal(expand("do chai"), "2 chai");
  assert.equal(expand("teen butter naan"), "3 butter naan");
  assert.equal(expand("char coke"), "4 coke");
  assert.equal(expand("ek paneer tikka"), "1 paneer tikka");
});

test("it reaches through a wrapping word, as the order handler does", () => {
  assert.equal(expand("do plate paneer tikka"), "2 plate paneer tikka");
});

test("several in one message all convert", () => {
  assert.equal(expand("ek paneer tikka aur do butter naan"), "1 paneer tikka aur 2 butter naan");
});

// --- Where it must stay silent ------------------------------------------

test("'do' as an ordinary English verb is left alone", () => {
  // This is the whole risk of the numeral list, so it is pinned hard.
  for (const t of ["do this now", "what should i do", "please do send it", "do it"]) {
    assert.equal(expand(t), t, t);
  }
});

test("a numeral word is not converted when a digit already states it", () => {
  assert.equal(expand("2 chai do"), "2 chai do");
});

test("a numeral before something the seller does NOT sell is left alone", () => {
  assert.equal(expand("do dosa"), "do dosa");
  assert.equal(expand("teen mutton biryani"), "teen mutton biryani");
});

test("an ordinary English order is untouched", () => {
  for (const t of ["2 paneer tikka 3 butter naan", "ravi 2 chai 3 samosa"]) {
    assert.equal(expand(t), t, t);
  }
});

test("the cheap pre-check agrees with the expander", () => {
  assert.ok(hasNumeralWord("do chai"));
  assert.ok(!hasNumeralWord("2 paneer tikka"));
  assert.ok(isNumeralWord("teen") && isNumeralWord("EK") && !isNumeralWord("chai"));
});

// --- A table number is not a quantity -----------------------------------

test("a table or room number is removed before the model sees it", () => {
  assert.equal(parseOrderExtras("room 12 me 3 chai bhejna").rest, "me 3 chai bhejna");
  assert.equal(parseOrderExtras("table 4 ko 2 paneer tikka").rest, "ko 2 paneer tikka");
  assert.equal(parseOrderExtras("table no 7 - 2 coke").rest, "- 2 coke");
});

test("a quantity BEFORE the word is not a table number", () => {
  // A quantity precedes what it counts; a table number follows its noun.
  assert.equal(parseOrderExtras("2 counter 40").charges.length, 0);
});

test("an ordinary order keeps every one of its numbers", () => {
  for (const t of ["2 paneer tikka 3 butter naan", "ravi 2 chai 3 samosa"]) {
    assert.equal(parseOrderExtras(t).rest, t, t);
  }
});

// --- A charge word is rarely alone --------------------------------------
//
// Reported: "home delivery 50" was SILENTLY DROPPED. The charge word had
// to be the whole phrase, so two words matched nothing, the line went to
// the model as an item, the model made no item of it, and ₹50 left a
// complete-looking bill. The seller read ₹920 believing it was ₹970.

test("a charge word anywhere in the phrase is enough", () => {
  for (const [line, label, amount] of [
    ["home delivery 50", "Delivery", 50],
    ["delivery charge 50", "Delivery", 50],
    ["extra packing 20", "Packing", 20],
    ["packing charges 30", "Packing", 30],
    ["50 home delivery", "Delivery", 50],
  ] as [string, string, number][]) {
    assert.deepEqual(parseOrderExtras(line).charges, [{ label, amount }], line);
  }
});

test("the canonical label prints, not the seller's spelling", () => {
  assert.deepEqual(parseOrderExtras("home delivary 50").charges, [{ label: "Delivery", amount: 50 }]);
});

test("an ordinary item line is never turned into a charge", () => {
  for (const line of ["3 thali 150", "1 dal fry 90", "2 paneer 120", "4 roti 15"]) {
    assert.deepEqual(parseOrderExtras(line).charges, [], line);
    assert.equal(parseOrderExtras(line).rest, line);
  }
});

test("the seller's own list wins over the charge word", () => {
  // A shop that genuinely sells "service tea" must not have it billed as a
  // Service charge, which no discount would touch.
  const sellsIt = (p: string) => p === "service tea";
  assert.deepEqual(parseOrderExtras("service tea 40", sellsIt).charges, []);
  assert.equal(parseOrderExtras("service tea 40", sellsIt).rest, "service tea 40");
});
