import { test } from "node:test";
import assert from "node:assert/strict";

// --- Confirming a price change -----------------------------------------
// Re-adding an existing item at a different price used to overwrite it
// silently, with a reply that read like a fresh save. A saved price is
// what every future bill charges, so it now waits for a tap.

import { encodePriceChange, decodePriceChange } from "../src/messageHandler.js";

test("a price change round-trips through a button", () => {
  const action = encodePriceChange("paneer", 200)!;
  assert.deepEqual(decodePriceChange(action), { name: "paneer", price: 200 });
});

test("the price rides in the action, not looked up again", () => {
  // What the seller taps must be exactly what they were shown, even if
  // another /add landed in between.
  const action = encodePriceChange("paneer butter masala", 440)!;
  assert.equal(decodePriceChange(action)!.price, 440);
});

test("decimal prices survive the round trip", () => {
  assert.equal(decodePriceChange(encodePriceChange("chai", 15.5)!)!.price, 15.5);
});

test("a free item is a valid price", () => {
  assert.equal(decodePriceChange(encodePriceChange("water", 0)!)!.price, 0);
});

test("a name too long for a button returns null rather than truncating", () => {
  assert.equal(encodePriceChange("a".repeat(70), 100), null);
});

test("other actions are not decoded as price changes", () => {
  assert.equal(decodePriceChange("confirm:1042"), null);
  assert.equal(decodePriceChange("merge:panner"), null);
  assert.equal(decodePriceChange("fix:ab"), null);
});

test("a malformed price action is rejected, never billed", () => {
  assert.equal(decodePriceChange("price:paneer"), null);
  assert.equal(decodePriceChange("price:"), null);
});

test("a negative price is rejected", () => {
  assert.equal(decodePriceChange("price:paneer-50"), null);
});

test("a non-numeric price is rejected", () => {
  assert.equal(decodePriceChange("price:paneerabc"), null);
});
