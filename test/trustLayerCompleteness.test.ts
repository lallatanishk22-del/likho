import { test } from "node:test";
import assert from "node:assert/strict";
import { assessTrust, computeTrustSignals } from "../src/trustLayer.js";
import type { ValidatedOrder } from "../src/structuredOrder.js";

// Experiment #6: item-completeness / coverage signal. Tests build
// ValidatedOrder fixtures directly (bypassing a live model call) so the
// signal's logic is tested deterministically and in isolation.

function order(items: ValidatedOrder["items"], discountPercent: number | null = null): ValidatedOrder {
  return { customer: null, items, discountPercent };
}

test("1. missing third item — should be rejected as incomplete", () => {
  const message = "2 biryani 280 wali + 1 raita 40 ka + 3 coke";
  const o = order([
    { name: "biryani", quantity: 2, unitPrice: 280, evidence: "2 biryani 280 wali" },
    { name: "raita", quantity: 1, unitPrice: 40, evidence: "1 raita 40 ka" },
  ]);
  const result = assessTrust(o, message);
  assert.equal(result.trusted, false);
  assert.deepEqual(result.signals.unaccountedQuantityMentions, [3]);
});

test("2. repeated same item on separate lines — both explicit, should be trusted", () => {
  const message = "3 coke 50, 2 fries 90, aur ek coke 50";
  const o = order([
    { name: "coke", quantity: 3, unitPrice: 50, evidence: "3 coke 50" },
    { name: "fries", quantity: 2, unitPrice: 90, evidence: "2 fries 90" },
    { name: "coke", quantity: 1, unitPrice: 50, evidence: "ek coke 50" },
  ]);
  const result = assessTrust(o, message);
  assert.equal(result.trusted, true);
  assert.deepEqual(result.signals.unaccountedQuantityMentions, []);
});

test("2b. repeated same item, but the second mention is DROPPED — should be rejected", () => {
  const message = "3 coke 50, 2 fries 90, aur ek coke 50";
  const o = order([
    { name: "coke", quantity: 3, unitPrice: 50, evidence: "3 coke 50" },
    { name: "fries", quantity: 2, unitPrice: 90, evidence: "2 fries 90" },
  ]);
  const result = assessTrust(o, message);
  assert.equal(result.trusted, false);
  assert.deepEqual(result.signals.unaccountedQuantityMentions, [1]);
});

test("3. spelled-out quantity with missing price — item present with null-safe absence, not silently dropped", () => {
  // This test targets the completeness signal specifically: a spelled-out
  // quantity ("two coffee") whose item never appears in the output at all.
  const message = "one cake 750, three pastry 120 each, two coffee";
  const o = order([
    { name: "cake", quantity: 1, unitPrice: 750, evidence: "one cake 750" },
    { name: "pastry", quantity: 3, unitPrice: 120, evidence: "three pastry 120 each" },
  ]);
  const result = assessTrust(o, message);
  assert.equal(result.trusted, false);
  assert.deepEqual(result.signals.unaccountedQuantityMentions, [2]);
});

test("4. total number is not an item — must not be flagged as missing", () => {
  const message = "3 burger 180 each aur 2 fries 90, total 720";
  const o = order([
    { name: "burger", quantity: 3, unitPrice: 180, evidence: "3 burger 180 each" },
    { name: "fries", quantity: 2, unitPrice: 90, evidence: "2 fries 90" },
  ]);
  const result = assessTrust(o, message);
  assert.equal(result.trusted, true);
  assert.deepEqual(result.signals.unaccountedQuantityMentions, []);
});

test("5. delivery fee is not an item — must not be flagged as missing", () => {
  const message = "4 burger 180, delivery 60, discount 20";
  const o = order([{ name: "burger", quantity: 4, unitPrice: 180, evidence: "4 burger 180" }]);
  const result = assessTrust(o, message);
  assert.equal(result.trusted, true);
  assert.deepEqual(result.signals.unaccountedQuantityMentions, []);
});

test("6. discount number is not an item — must not be flagged as missing", () => {
  const message = "do rajma chawal 150 aur 3 kadhi chawal 140, discount 50";
  const o = order([
    { name: "rajma chawal", quantity: 2, unitPrice: 150, evidence: "do rajma chawal 150" },
    { name: "kadhi chawal", quantity: 3, unitPrice: 140, evidence: "3 kadhi chawal 140" },
  ]);
  const result = assessTrust(o, message);
  assert.equal(result.trusted, true);
  assert.deepEqual(result.signals.unaccountedQuantityMentions, []);
});

test("7. two different products with the same price — legitimate, must be trusted", () => {
  const message = "2 paneer wrap 160 + 2 paneer roll 160";
  const o = order([
    { name: "paneer wrap", quantity: 2, unitPrice: 160, evidence: "2 paneer wrap 160" },
    { name: "paneer roll", quantity: 2, unitPrice: 160, evidence: "2 paneer roll 160" },
  ]);
  const result = assessTrust(o, message);
  assert.equal(result.trusted, true);
  assert.deepEqual(result.signals.unaccountedQuantityMentions, []);
  // Confirms the existing priceReusedAcrossItems signal still fires (informational
  // combined with empty unexplainedNumbers) without blocking — unchanged behavior.
  assert.equal(result.signals.priceReusedAcrossItems, true);
});

test("8. same product with different prices — potentially legitimate, must be trusted", () => {
  const message = "2 biryani 280, 1 biryani 300";
  const o = order([
    { name: "biryani", quantity: 2, unitPrice: 280, evidence: "2 biryani 280" },
    { name: "biryani", quantity: 1, unitPrice: 300, evidence: "1 biryani 300" },
  ]);
  const result = assessTrust(o, message);
  assert.equal(result.trusted, true);
  assert.deepEqual(result.signals.unaccountedQuantityMentions, []);
});

test("9. existing valid multi-item order — unaffected by the new signal", () => {
  const message = "bhai 2 paneer roll 120 each aur 3 coke 50, 1 brownie 80";
  const o = order([
    { name: "paneer roll", quantity: 2, unitPrice: 120, evidence: "2 paneer roll 120 each" },
    { name: "coke", quantity: 3, unitPrice: 50, evidence: "3 coke 50" },
    { name: "brownie", quantity: 1, unitPrice: 80, evidence: "1 brownie 80" },
  ]);
  const result = assessTrust(o, message);
  assert.equal(result.trusted, true);
  assert.deepEqual(result.signals.unaccountedQuantityMentions, []);
});

test("10a. Experiment #4's known silent-omission example is now caught", () => {
  const message = "2 biryani 280 wali + 1 raita 40 ka + 3 coke";
  const o = order([
    { name: "biryani", quantity: 2, unitPrice: 280, evidence: "2 biryani 280 wali" },
    { name: "raita", quantity: 1, unitPrice: 40, evidence: "1 raita 40 ka" },
  ]);
  assert.equal(assessTrust(o, message).trusted, false);
});

test("10b. Experiment #5 #12's known silent-omission example is now caught", () => {
  const message = "3 coke 50, 2 fries 90, aur ek coke 50";
  const o = order([
    { name: "coke", quantity: 3, unitPrice: 50, evidence: "3 coke 50" },
    { name: "fries", quantity: 2, unitPrice: 90, evidence: "2 fries 90" },
  ]);
  assert.equal(assessTrust(o, message).trusted, false);
});

test("10c. Experiment #5 #17's known silent-omission example is now caught", () => {
  const message = "one cake 750, three pastry 120 each, two coffee";
  const o = order([
    { name: "cake", quantity: 1, unitPrice: 750, evidence: "one cake 750" },
    { name: "pastry", quantity: 3, unitPrice: 120, evidence: "three pastry 120 each" },
  ]);
  assert.equal(assessTrust(o, message).trusted, false);
});

test("regression: 'do' as a Hinglish verb ending ('bana do') must not be misread as quantity two", () => {
  const message = "bhaiya 2 lassi bana do 40 rupaye ka";
  const o = order([{ name: "lassi", quantity: 2, unitPrice: 40, evidence: "2 lassi bana do 40 rupaye ka" }]);
  const result = assessTrust(o, message);
  assert.equal(result.trusted, true);
  assert.deepEqual(result.signals.unaccountedQuantityMentions, []);
});

test("existing signals unchanged: duplicateEvidenceAcrossItems still gates independently", () => {
  const message = "1 thali 150 1 thali 150";
  const o = order([
    { name: "thali", quantity: 1, unitPrice: 150, evidence: "1 thali 150" },
    { name: "thali", quantity: 1, unitPrice: 150, evidence: "1 thali 150" },
  ]);
  const result = assessTrust(o, message);
  assert.equal(result.signals.duplicateEvidenceAcrossItems, true);
  assert.equal(result.trusted, false);
});

test("computeTrustSignals still returns the same 3 pre-existing fields plus the new one", () => {
  const message = "2 chicken biryani 450 1 raita 80";
  const o = order([
    { name: "chicken biryani", quantity: 2, unitPrice: 450, evidence: "2 chicken biryani 450" },
    { name: "raita", quantity: 1, unitPrice: 80, evidence: "1 raita 80" },
  ]);
  const signals = computeTrustSignals(o, message);
  assert.equal(signals.priceReusedAcrossItems, false);
  assert.equal(signals.duplicateEvidenceAcrossItems, false);
  assert.deepEqual(signals.unexplainedNumbers, []);
  assert.deepEqual(signals.unaccountedQuantityMentions, []);
});
