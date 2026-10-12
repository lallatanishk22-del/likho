import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent } from "../src/intent.js";

test("a bill number before the amount does not swallow the amount", () => {
  for (const text of ["#1001 paid 50", "#1001 paid ₹50", "#1001 50 paid", "#1001 paid rs 50"]) {
    const intent = classifyIntent(text);
    assert.equal(intent.name, "payment", text);
    assert.equal(intent.billNo, 1001, text);
    assert.equal(intent.amount, 50, text);
  }
});

test("a lakh-formatted amount is one number", () => {
  assert.equal(classifyIntent("#1042 paid 1,500").amount, 1500);
});

test("dates and times are never read as the amount", () => {
  for (const text of ["#1042 paid on 12/10", "#1042 paid 12 oct", "#1042 paid at 5pm", "#1042 paid at 5:30"]) {
    assert.equal(classifyIntent(text).amount, null, text);
  }
  assert.equal(classifyIntent("#1042 paid 500 on 12/10").amount, 500);
});

test("no amount still means paid in full", () => {
  assert.equal(classifyIntent("#1042 paid").amount, null);
});
