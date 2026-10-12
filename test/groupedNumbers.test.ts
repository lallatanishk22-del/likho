import { test } from "node:test";
import assert from "node:assert/strict";
import { joinGroupedNumbers } from "../src/groupedNumbers.js";

test("Indian lakh grouping is one number", () => {
  assert.equal(joinGroupedNumbers("tanisk 1,00,000 gold"), "tanisk 100000 gold");
  assert.equal(joinGroupedNumbers("10,00,000"), "1000000");
});

test("Western thousands grouping is one number", () => {
  assert.equal(joinGroupedNumbers("gold 100,000"), "gold 100000");
  assert.equal(joinGroupedNumbers("1,000,000"), "1000000");
  assert.equal(joinGroupedNumbers("₹1,500 each"), "₹1500 each");
});

test("short comma lists are not numbers", () => {
  assert.equal(joinGroupedNumbers("2,3 samosa"), "2,3 samosa");
  assert.equal(joinGroupedNumbers("chai 2, samosa 3"), "chai 2, samosa 3");
});
