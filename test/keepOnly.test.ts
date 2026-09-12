import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent } from "../src/intent.js";
import { encodeMerge, decodeMerge } from "../src/messageHandler.js";

const name = (t: string) => classifyIntent(t).name;
const text = (t: string) => classifyIntent(t).text;

// --- Answering the duplicate question IN WORDS ---------------------------
//
// The bot asked which of two names to keep, then could not understand the
// answer: "keep only cake" reached the ORDER parser and came back
// "Quantity for cake (1) isn't clearly supported by the message."
//
// Asking a question you cannot hear the answer to is worse than not asking.

test("'keep only cake' is understood", () => {
  assert.equal(name("keep only cake"), "keep_only");
  assert.equal(text("keep only cake"), "cake");
});

test("the shorter forms work too", () => {
  assert.equal(name("keep cake"), "keep_only");
  assert.equal(name("keep just cake"), "keep_only");
  assert.equal(text("keep just cake"), "cake");
});

test("quotes around the name are stripped", () => {
  assert.equal(text('keep only "cake"'), "cake");
});

test("a multi-word name survives", () => {
  assert.equal(text("keep only paneer roll"), "paneer roll");
});

test("an order is never read as a keep instruction", () => {
  // "keep" with a quantity is not this — nothing here should swallow a bill.
  assert.notEqual(name("keep 2 cake"), "keep_only");
  assert.equal(name("ravi 2 cake"), "order");
});

// --- Both names get a button --------------------------------------------
//
// The seller was shown one button, "Keep only caku", with no way to keep
// "cake" — very likely the answer they wanted. One option is not a choice.

test("a merge action round-trips for either name", () => {
  for (const dropped of ["cake", "caku", "paneer butter masala"]) {
    assert.equal(decodeMerge(encodeMerge(dropped)!), dropped);
  }
});

test("the two buttons drop different products", () => {
  // Keeping "cake" drops "caku", and vice versa — they are not the same
  // action with a different label.
  const keepCake = encodeMerge("caku")!;
  const keepCaku = encodeMerge("cake")!;
  assert.notEqual(keepCake, keepCaku);
  assert.equal(decodeMerge(keepCake), "caku");
  assert.equal(decodeMerge(keepCaku), "cake");
});

test("a name too long for a button returns null rather than truncating", () => {
  assert.equal(encodeMerge("a".repeat(70)), null);
});
