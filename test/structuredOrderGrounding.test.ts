import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStructuredShape } from "../src/structuredOrder.js";

// Fixtures are the model's ACTUAL raw output (captured via
// parseOrderWithLocalAIDiagnosed against the live local model), not
// hand-invented data — these test the validator's grounding logic in
// isolation, deterministically, against real qwen2.5:7b responses from
// Experiment #1 (see eval/experiments/baselineMessages.ts).
//
// Before the fix, ALL TEN of these were validator-rejected because
// numberAppearsIn(quantity, evidence) required the quantity digit inside
// the same short evidence quote as the price. The fix grounds each number
// independently against the whole original message instead.

test("#3: quantity and price separated by other words — should now pass", () => {
  const message = "Need 5 veg sandwich, 90 each. Deliver by 6";
  const raw = {
    status: "valid",
    customer: null,
    items: [{ name: "veg sandwich", quantity: 5, unitPrice: 90, evidence: "90 each" }],
    discountPercent: null,
    clarification: null,
  };
  const result = validateStructuredShape(raw, message);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]!.quantity, 5);
  assert.equal(result.items[0]!.unitPrice, 90);
});

test("#5: two items, quantity/price far from each other's evidence — should now pass", () => {
  const message = "bhai 20 samosa 15 rs aur 5 kachori 20";
  const raw = {
    status: "valid",
    customer: null,
    items: [
      { name: "samosa", quantity: 20, unitPrice: 15, evidence: "15 rs" },
      { name: "kachori", quantity: 5, unitPrice: 20, evidence: "20" },
    ],
    discountPercent: null,
    clarification: null,
  };
  const result = validateStructuredShape(raw, message);
  assert.equal(result.items.length, 2);
});

test("#6: model asserts an implicit quantity (1) never written as a digit — should STILL be rejected", () => {
  const message = "2 pizza 450 and coke 60 ke 3";
  const raw = {
    status: "valid",
    customer: null,
    items: [
      { name: "pizza", quantity: 2, unitPrice: 450, evidence: "450" },
      { name: "coke", quantity: 1, unitPrice: 60, evidence: "60 ke 3" },
    ],
    discountPercent: null,
    clarification: null,
  };
  // "1" never appears as a digit anywhere in the message — coke's quantity
  // is genuinely ungrounded (the model defaulted to 1 without basis), and
  // requirement #3 (preserve hallucination protection) means this must
  // still fail, for a real reason unrelated to the co-location bug.
  assert.throws(() => validateStructuredShape(raw, message), /Quantity for "coke"/);
});

test("#9: quantity/price separated by Hinglish connector words — should now pass", () => {
  const message = "bhai 2 thali 180 ki aur 3 lassi 70 wali";
  const raw = {
    status: "valid",
    customer: null,
    items: [
      { name: "thali", quantity: 2, unitPrice: 180, evidence: "180 ki" },
      { name: "lassi", quantity: 3, unitPrice: 70, evidence: "70 wali" },
    ],
    discountPercent: null,
    clarification: null,
  };
  const result = validateStructuredShape(raw, message);
  assert.equal(result.items.length, 2);
});

test("#11: quantity stated well before price mention — should now pass", () => {
  const message = "kal ke liye 10 samose chahiye 20 rs wale";
  const raw = {
    status: "valid",
    customer: null,
    items: [{ name: "samose", quantity: 10, unitPrice: 20, evidence: "20 rs wale" }],
    discountPercent: null,
    clarification: null,
  };
  const result = validateStructuredShape(raw, message);
  assert.equal(result.items[0]!.quantity, 10);
});

test("#12 (Experiment #3): quantity spelled as an English word ('one') — should now pass", () => {
  const message = "2 chicken biryani 280, one veg biryani 220";
  const raw = {
    status: "valid",
    customer: null,
    items: [
      { name: "chicken biryani", quantity: 2, unitPrice: 280, evidence: "2 chicken biryani 280" },
      { name: "veg biryani", quantity: 1, unitPrice: 220, evidence: "one veg biryani 220" },
    ],
    discountPercent: null,
    clarification: null,
  };
  // "one" explicitly states the quantity, just not as a digit — recognized
  // as of Experiment #3's spelled-out-quantity fix.
  const result = validateStructuredShape(raw, message);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[1]!.quantity, 1);
});

test("#16: repeated quantity value across items, separated from prices — should now pass", () => {
  const message = "mujhe 2 rajma chawal 150 aur 2 kadhi chawal 140 chahiye";
  const raw = {
    status: "valid",
    customer: null,
    items: [
      { name: "rajma chawal", quantity: 2, unitPrice: 150, evidence: "150" },
      { name: "kadhi chawal", quantity: 2, unitPrice: 140, evidence: "140" },
    ],
    discountPercent: null,
    clarification: null,
  };
  const result = validateStructuredShape(raw, message);
  assert.equal(result.items.length, 2);
});

test("#17: no separators between item mentions, quantity/price separated — should now pass", () => {
  const message = "4 burger 2 fries burger 180 fries 90";
  const raw = {
    status: "valid",
    customer: null,
    items: [
      { name: "burger", quantity: 4, unitPrice: 180, evidence: "burger 180" },
      { name: "fries", quantity: 2, unitPrice: 90, evidence: "fries 90" },
    ],
    discountPercent: null,
    clarification: null,
  };
  const result = validateStructuredShape(raw, message);
  assert.equal(result.items.length, 2);
});

test("#18 (Experiment #3): one item's quantity spelled in Hindi ('ek') — should now pass", () => {
  const message = "bhai ek cake 750 ka and 3 pastry 120 each";
  const raw = {
    status: "valid",
    customer: null,
    items: [
      { name: "cake", quantity: 1, unitPrice: 750, evidence: "ek cake 750 ka" },
      { name: "pastry", quantity: 3, unitPrice: 120, evidence: "3 pastry 120 each" },
    ],
    discountPercent: null,
    clarification: null,
  };
  const result = validateStructuredShape(raw, message);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]!.quantity, 1);
});

test("#20 (Experiment #3): three items, one with a spelled quantity ('ek') — should now pass", () => {
  const message = "bhai 2 roll 120, 3 samosa 20, aur ek biryani 280 wali bhej dena";
  const raw = {
    status: "valid",
    customer: null,
    items: [
      { name: "roll", quantity: 2, unitPrice: 120, evidence: "2 roll 120" },
      { name: "samosa", quantity: 3, unitPrice: 20, evidence: "3 samosa 20" },
      { name: "biryani", quantity: 1, unitPrice: 280, evidence: "ek biryani 280 wali" },
    ],
    discountPercent: null,
    clarification: null,
  };
  const result = validateStructuredShape(raw, message);
  assert.equal(result.items.length, 3);
  assert.equal(result.items[2]!.quantity, 1);
});

test("Experiment #3 scope: spelled-out quantity recognized, but spelled-out price is NOT", () => {
  const message = "do samosa fifty rupees";
  const raw = {
    status: "valid",
    customer: null,
    items: [{ name: "samosa", quantity: 2, unitPrice: 50, evidence: "do samosa fifty rupees" }],
    discountPercent: null,
    clarification: null,
  };
  // "do" (2) is a recognized quantity word and should pass. "fifty" (50) is
  // a spelled-out PRICE, which is deliberately out of scope for this fix —
  // digit-only grounding still applies to price/discount.
  assert.throws(() => validateStructuredShape(raw, message), /Price for "samosa"/);
});

test("#15 is untouched by this fix: model's own clarification never reaches the validator", () => {
  // Requirement: do NOT infer 90/unit for "6 sandwiches total 540" — this
  // case never reaches validateStructuredShape at all, because the MODEL
  // itself returns status:"clarification" (see Experiment #1 raw log). This
  // test documents that guarantee: a clarification-status payload is
  // rejected immediately, before any grounding check runs, regardless of
  // this fix.
  const raw = {
    status: "clarification",
    customer: null,
    items: [],
    discountPercent: null,
    clarification: "Is the price of 90 for each sandwich?",
  };
  assert.throws(
    () => validateStructuredShape(raw, "order: 6 sandwiches total 540"),
    /Is the price of 90 for each sandwich\?/,
  );
});
