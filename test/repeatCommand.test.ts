import { test } from "node:test";
import assert from "node:assert/strict";
import { isRepeatedBareCommand } from "../src/repeatCommand.js";

test("one tap that sends /start twice is answered once", () => {
  const seen = new Map();
  assert.equal(isRepeatedBareCommand(seen, 1, "/start", 1000), false);
  assert.equal(isRepeatedBareCommand(seen, 1, "/start", 1400), true);
  assert.equal(isRepeatedBareCommand(seen, 1, "/start@zbillingbot", 1600), true);
});

test("a later /start, another chat, or another command is answered", () => {
  const seen = new Map();
  isRepeatedBareCommand(seen, 1, "/start", 0);
  assert.equal(isRepeatedBareCommand(seen, 1, "/start", 6000), false, "after 5 seconds");
  assert.equal(isRepeatedBareCommand(seen, 2, "/start", 6100), false, "different chat");
  assert.equal(isRepeatedBareCommand(seen, 1, "/help", 6200), false, "different command");
});

test("orders and commands with text are never treated as repeats here", () => {
  const seen = new Map();
  isRepeatedBareCommand(seen, 1, "/bill 2 chai", 0);
  assert.equal(isRepeatedBareCommand(seen, 1, "/bill 2 chai", 100), false);
  assert.equal(isRepeatedBareCommand(seen, 1, "2 chai", 200), false);
  assert.equal(isRepeatedBareCommand(seen, 1, "2 chai", 300), false);
});
