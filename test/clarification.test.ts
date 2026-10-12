import { test } from "node:test";
import assert from "node:assert/strict";
import { applyClarification } from "../src/clarification.js";

const Q = "What quantity of pizza would you like to order?";

test("a bare number answering a quantity question goes in front of that item", () => {
  assert.equal(applyClarification("pizza rohan 55", Q, "44"), "44 pizza rohan 55");
});

test("a stray word next to the number still counts as the number", () => {
  assert.equal(applyClarification("pizza rohan 55", "Please provide the quantity for pizza.", "12 qtyl"), "12 pizza rohan 55");
});

test("answering again replaces the quantity instead of stacking a second one", () => {
  const once = applyClarification("pizza rohan 55", Q, "44");
  assert.equal(applyClarification(once, Q, "33"), "33 pizza rohan 55");
});

test("the number lands on the item the question named, not the first item", () => {
  assert.equal(
    applyClarification("rohan 2 chai samosa", "How many samosa?", "3"),
    "rohan 2 chai 3 samosa",
  );
});

test("an answer to any other question is appended as order text", () => {
  assert.equal(
    applyClarification("rohan pizza", 'No price found for "pizza".', "₹55"),
    "rohan pizza ₹55",
  );
});
