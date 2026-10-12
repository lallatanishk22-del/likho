import { test } from "node:test";
import assert from "node:assert/strict";
import { paymentStatusFor } from "../src/billStore.js";

test("a paid bill that grows is partial, not paid", () => {
  assert.equal(paymentStatusFor(100, 140), "partial");
});

test("a paid bill that shrinks stays paid", () => {
  assert.equal(paymentStatusFor(100, 60), "paid");
});

test("exact payment is paid, nothing received is pending", () => {
  assert.equal(paymentStatusFor(100, 100), "paid");
  assert.equal(paymentStatusFor(0, 100), "pending");
});

test("an emptied bill with nothing received is pending, not paid", () => {
  assert.equal(paymentStatusFor(0, 0), "pending");
});
