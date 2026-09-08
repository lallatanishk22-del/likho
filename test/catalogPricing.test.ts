import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePrices, applyCatalog, type PriceCatalog } from "../src/catalog.js";
import { validateStructuredShape } from "../src/structuredOrder.js";

const catalog: PriceCatalog = {
  businessId: "biz-1",
  products: [
    { id: "p-paneer", name: "paneer", price: 120, aliases: ["paneer sabzi"] },
    { id: "p-samosa", name: "samosa", price: 20, aliases: ["samose"] },
    { id: "p-lassi", name: "lassi", price: 100, aliases: [] },
  ],
};

// ── Price resolution ─────────────────────────────────────────────────

test("resolves an unpriced item from the catalog", () => {
  const { resolved, unresolved } = resolvePrices(
    [{ name: "paneer", quantity: 2, unitPrice: null, evidence: "2 paneer" }],
    catalog,
  );
  assert.equal(unresolved.length, 0);
  assert.equal(resolved[0]!.unitPrice, 120);
  assert.equal(resolved[0]!.priceSource, "catalog");
  assert.equal(resolved[0]!.productId, "p-paneer");
});

test("matches plural forms and registered aliases", () => {
  const { resolved } = resolvePrices(
    [
      { name: "samosas", quantity: 4, unitPrice: null, evidence: "4 samosas" },
      { name: "samose", quantity: 3, unitPrice: null, evidence: "3 samose" },
    ],
    catalog,
  );
  assert.equal(resolved[0]!.unitPrice, 20);
  assert.equal(resolved[1]!.unitPrice, 20);
});

test("a price stated in the message overrides the catalog price", () => {
  const { resolved } = resolvePrices(
    [{ name: "paneer", quantity: 2, unitPrice: 150, evidence: "2 paneer 150" }],
    catalog,
  );
  assert.equal(resolved[0]!.unitPrice, 150, "stated price must win over catalog's 120");
  assert.equal(resolved[0]!.priceSource, "stated");
});

test("an item absent from the catalog is NOT priced — it is reported unresolved", () => {
  const { resolved, unresolved } = resolvePrices(
    [{ name: "puri bhaji", quantity: 4, unitPrice: null, evidence: "4 puri bhaji" }],
    catalog,
  );
  assert.equal(resolved.length, 0);
  assert.equal(unresolved[0]!.reason, "not_in_catalog");
});

test("an ambiguous catalog match refuses to resolve rather than picking one", () => {
  const ambiguous: PriceCatalog = {
    businessId: "biz-1",
    products: [
      { id: "a", name: "thali", price: 150, aliases: [] },
      { id: "b", name: "thali special", price: 220, aliases: ["thali"] },
    ],
  };
  const { resolved, unresolved } = resolvePrices(
    [{ name: "thali", quantity: 1, unitPrice: null, evidence: "1 thali" }],
    ambiguous,
  );
  assert.equal(resolved.length, 0);
  assert.equal(unresolved[0]!.reason, "ambiguous_in_catalog");
});

// ── The safety property: catalog provenance is not a bypass ──────────

test("SAFETY: a catalog price is accepted even though it is absent from the message", () => {
  const message = "2 paneer";
  const raw = {
    status: "valid",
    customer: null,
    items: [{ name: "paneer", quantity: 2, unitPrice: null, evidence: "2 paneer" }],
    discountPercent: null,
    clarification: null,
  };
  const withPrices = applyCatalog(raw, catalog);
  const validated = validateStructuredShape(withPrices, message);
  assert.equal(validated.items[0]!.unitPrice, 120);
  assert.equal(validated.items[0]!.priceSource, "catalog");
});

test("SAFETY: a model-invented price is STILL rejected when no catalog is in play", () => {
  const message = "2 paneer";
  const raw = {
    status: "valid",
    customer: null,
    // 999 appears nowhere in the message and is not catalog-sourced.
    items: [{ name: "paneer", quantity: 2, unitPrice: 999, evidence: "2 paneer" }],
    discountPercent: null,
    clarification: null,
  };
  assert.throws(() => validateStructuredShape(raw, message), /Price for "paneer"/);
});

test("SAFETY: a model cannot forge catalog provenance to smuggle an invented price", () => {
  // applyCatalog is the ONLY thing that may set priceSource:"catalog", and
  // it rebuilds every item from scratch — a model's own claim of catalog
  // provenance never survives. Here the model both invents ₹999 AND claims
  // it came from the catalog; applyCatalog downgrades it to "stated"
  // (because a number was supplied), and message-grounding then rejects it
  // outright, since 999 appears nowhere in the message.
  const message = "2 paneer";
  const forged = {
    status: "valid",
    customer: null,
    items: [
      { name: "paneer", quantity: 2, unitPrice: 999, evidence: "2 paneer", priceSource: "catalog" },
    ],
    discountPercent: null,
    clarification: null,
  };
  const rebuilt = applyCatalog(forged, catalog);
  assert.equal(
    (rebuilt["items"] as Record<string, unknown>[])[0]!["priceSource"],
    "stated",
    "forged catalog provenance must be downgraded to 'stated'",
  );
  assert.throws(
    () => validateStructuredShape(rebuilt, message),
    /Price for "paneer"/,
    "an invented price must still be rejected despite the forged claim",
  );
});

test("SAFETY: quantity grounding is unaffected by catalog pricing", () => {
  const message = "paneer please";
  const raw = {
    status: "valid",
    customer: null,
    // Quantity 7 appears nowhere in the message — must still be rejected
    // even though the price resolves cleanly from the catalog.
    items: [{ name: "paneer", quantity: 7, unitPrice: null, evidence: "paneer" }],
    discountPercent: null,
    clarification: null,
  };
  const withPrices = applyCatalog(raw, catalog);
  assert.throws(() => validateStructuredShape(withPrices, message), /Quantity for "paneer"/);
});

test("applyCatalog is a no-op without a catalog — existing behaviour preserved", () => {
  const raw = {
    status: "valid",
    customer: null,
    items: [{ name: "paneer", quantity: 2, unitPrice: 120, evidence: "2 paneer 120" }],
    discountPercent: null,
    clarification: null,
  };
  assert.deepEqual(applyCatalog(raw, undefined), raw);
});

test("unresolved items produce a seller-facing message, not a crash", () => {
  const raw = {
    status: "valid",
    customer: null,
    items: [{ name: "puri bhaji", quantity: 4, unitPrice: null, evidence: "4 puri bhaji" }],
    discountPercent: null,
    clarification: null,
  };
  assert.throws(() => applyCatalog(raw, catalog), /don't have a price for "puri bhaji"/);
});
