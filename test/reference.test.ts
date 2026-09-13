import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalogIndex, findProductByFragment, resolvePrices } from "../src/catalog.js";
import { parseAdvancePaid, parseOrderExtras } from "../src/orderExtras.js";

// Hindi POINTS at things. "arey woh cheese wala bhi 1 60 ka" is "that
// cheese one as well, one, for sixty" — the seller naming a product they
// already sell, indirectly. It billed a brand new product called "Cheese
// Wala Bhi", which then PRINTS on the customer's bill.

const catalog = {
  businessId: "test",
  products: [
    { id: "1", name: "paneer roll", price: 120, aliases: [] },
    { id: "2", name: "paneer tikka", price: 180, aliases: [] },
    { id: "3", name: "cheese sandwich", price: 60, aliases: [] },
    { id: "4", name: "chai", price: 15, aliases: [] },
  ],
};
const index = buildCatalogIndex(catalog);
const frag = (n: string) => {
  const r = findProductByFragment(n, index);
  return r === null || r === "ambiguous" ? r : r.product.name;
};

test("a reference resolves to the product it points at", () => {
  assert.equal(frag("arey woh cheese wala bhi"), "cheese sandwich");
  assert.equal(frag("woh chai wali"), "chai");
});

test("the Hindi particles need no list — they match nothing and drop out", () => {
  // "wala", "bhi", "woh", "arey" are not enumerated anywhere. They are
  // simply not in the price list, so only "cheese" carries signal.
  assert.equal(frag("woh wala bhi"), null);
  assert.equal(frag("arey yaar woh"), null);
});

test("a reference that fits two products ASKS", () => {
  // "woh paneer wala" — roll or tikka? A coin toss here bills the wrong
  // item at the wrong price.
  assert.equal(frag("woh paneer wala"), "ambiguous");
});

test("a genuinely new item is not forced onto an existing product", () => {
  assert.equal(frag("cold drink"), null);
});

test("short tokens are noise and are ignored", () => {
  // "ka", "hi", "ye" would otherwise match half a menu by accident.
  assert.equal(frag("ka hi ye"), null);
});

// --- A STATED PRICE SETTLES THE MONEY, NOT THE NAME ---------------------

test("a stated price still gets the catalog's name on the bill", () => {
  // This is the reported bug: the price was right and the document was
  // embarrassing.
  const { resolved } = resolvePrices(
    [{ name: "woh cheese wala bhi", quantity: 1, unitPrice: 60, evidence: "cheese wala bhi 1 60" }],
    catalog,
  );
  assert.equal(resolved[0]!.name, "cheese sandwich");
  assert.equal(resolved[0]!.unitPrice, 60, "the seller's stated price still wins");
  assert.equal(resolved[0]!.priceSource, "stated");
});

test("an item that is genuinely not in the list still bills at the stated price", () => {
  const { resolved, unresolved } = resolvePrices(
    [{ name: "cold drink", quantity: 1, unitPrice: 40, evidence: "1 cold drink 40" }],
    catalog,
  );
  assert.deepEqual(unresolved, []);
  assert.equal(resolved[0]!.name, "cold drink");
  assert.equal(resolved[0]!.unitPrice, 40);
});

// --- "500 diya hai baki kitna" ------------------------------------------
//
// Money already handed over, stated in the same breath as the order. It
// came back as "I didn't use: 500. If that's a charge, send: delivery 500"
// — the opposite of what was said.

test("an advance stated with the order is read", () => {
  for (const [line, amount] of [
    ["500 diya hai baki kitna", 500],
    ["500 de diya", 500],
    ["1000 diye hain", 1000],
    ["paid 300", 300],
    ["advance 200", 200],
    ["₹500 diya", 500],
  ] as [string, number][]) {
    assert.equal(parseAdvancePaid(line), amount, line);
  }
});

test("an order line is never read as a payment", () => {
  // The amount must sit beside the word for handing money over.
  for (const line of ["3 paneer roll 120", "1 cold drink 40", "delivery 30", "2 chai 15"]) {
    assert.equal(parseAdvancePaid(line), null, line);
  }
});

test("a payment word with no amount is not a payment", () => {
  assert.equal(parseAdvancePaid("paisa diya hai"), null);
  assert.equal(parseAdvancePaid("diya"), null);
});

test("the advance comes out of the extractor and off the item lines", () => {
  const e = parseOrderExtras(
    "Meena 3 paneer roll 120\n1 cold drink 40\ndelivery 30\n500 diya hai baki kitna",
  );
  assert.equal(e.advancePaid, 500);
  assert.deepEqual(e.charges, [{ label: "Delivery", amount: 30 }]);
  assert.ok(!e.rest.includes("500"), "the advance must not reach the extractor as an item");
  assert.ok(e.rest.includes("3 paneer roll 120"), "the order itself must survive");
});

test("an ordinary order states no advance", () => {
  assert.equal(parseOrderExtras("ravi 2 paneer 1 chai").advancePaid, null);
});
