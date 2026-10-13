import { test } from "node:test";
import assert from "node:assert/strict";
import { ModelHealth, isHealthFailure } from "../src/modelHealth.js";

test("three failures in a row pause the local model; a success resets", () => {
  const h = new ModelHealth(3, 600_000);
  assert.equal(h.recordFailure(0), false);
  assert.equal(h.recordFailure(0), false);
  assert.equal(h.recordFailure(0), true, "the third failure pauses");
  assert.ok(h.isPaused(1000));
  assert.ok(!h.isPaused(600_001), "local is tried again after the pause");

  const g = new ModelHealth(3, 600_000);
  g.recordFailure(0);
  g.recordFailure(0);
  g.recordSuccess();
  assert.equal(g.recordFailure(0), false, "failures must be in a row");
});

test("only the model's own failures count, not a refused message", () => {
  assert.ok(isHealthFailure(new TypeError("fetch failed")));
  assert.ok(isHealthFailure(new Error("Local model timed out after 20s.")));
  assert.ok(isHealthFailure(new Error("Local model unavailable (500). Is Ollama running?")));
  assert.ok(isHealthFailure(new Error("Local model returned invalid JSON. Please try rephrasing the order.")));
  assert.ok(!isHealthFailure(new Error('Quantity for "pizza" (1) isn\'t clearly supported by the message.')));
  assert.ok(!isHealthFailure(new Error('No price found for "pizza".')));
});
