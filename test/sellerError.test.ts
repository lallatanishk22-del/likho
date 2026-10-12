import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyError, sellerFacing, CONNECTION_MESSAGE, ORDER_MESSAGE, GENERIC_MESSAGE,
} from "../src/sellerError.js";

const quiet = <T>(fn: () => T): T => {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
};

test("the database error a seller actually saw is never shown", () => {
  const raw =
    'Supabase request failed (409): {"code":"23505","details":"Key (business_id, name)=(15c9…, cake) already exists.",' +
    '"message":"duplicate key value violates unique constraint \\"products_business_id_name_key\\""}';
  assert.equal(quiet(() => sellerFacing(new Error(raw))), GENERIC_MESSAGE);
});

test("connection failures say so plainly", () => {
  for (const m of ["fetch failed", "Supabase request failed (503): Service Unavailable", "connect ECONNREFUSED 127.0.0.1:11434"]) {
    assert.equal(quiet(() => sellerFacing(new Error(m))), CONNECTION_MESSAGE, m);
  }
});

test("model failures become the order-not-understood message", () => {
  for (const m of ["Local model returned invalid JSON. Please try rephrasing the order.", "Cloud model unavailable — rate limited.", "AI returned an item with no name at position 2."]) {
    assert.equal(quiet(() => sellerFacing(new Error(m))), ORDER_MESSAGE, m);
  }
});

test("code crashes never leak", () => {
  assert.equal(quiet(() => sellerFacing(new TypeError("Cannot read properties of undefined (reading 'id')"))), GENERIC_MESSAGE);
});

test("questions written for the seller pass through untouched, even with numbers in brackets", () => {
  for (const m of [
    'No price found for "pizza". Please state the price, e.g. "pizza ₹100 each".',
    'Quantity for "pizza" (100) isn\'t clearly supported by the message. Please confirm.',
    'Price for "chai" (₹500) isn\'t clearly supported by the message. Please confirm.',
    "What quantity of pizza would you like to order?",
    "Couldn't find any items in this order. Please resend the items and quantities.",
  ]) {
    assert.equal(classifyError(m), "seller", m);
    assert.equal(sellerFacing(new Error(m)), m);
  }
});
