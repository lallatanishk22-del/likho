import { test } from "node:test";
import assert from "node:assert/strict";

// --- Setting a business up ------------------------------------------------
// Setup is the only place where a seller's answer becomes a permanent
// business fact before any bill exists — the shop name that prints on
// every bill, and the prices every future bill is calculated from. So the
// reading of an answer is tested harder than the copy around it.

import {
  asOnboardingStep,
  BUSINESS_KINDS,
  decodeKind,
  encodeKind,
  finishedMessage,
  isSkip,
  kindById,
  looksLikeAnOrder,
  nameQuestion,
  pricesQuestion,
  readBusinessKind,
  readShopName,
  welcomeQuestion,
  SKIP_ACTION,
} from "../src/onboarding.js";
import { TEMPLATE_IDS } from "../src/billData.js";
import { classifyIntent } from "../src/intent.js";

// --- Resuming -------------------------------------------------------------

test("an unknown step is treated as finished, never as a fresh seller", () => {
  // A row written by a different version must not reopen a questionnaire
  // in front of a business that has been billing for weeks.
  assert.equal(asOnboardingStep("something_else"), "done");
  assert.equal(asOnboardingStep(null), "done");
  assert.equal(asOnboardingStep(undefined), "done");
});

test("the real steps survive a round trip through the database", () => {
  for (const step of ["kind", "name", "prices", "done"]) {
    assert.equal(asOnboardingStep(step), step);
  }
});

// --- What kind of business ------------------------------------------------

test("every kind maps to a bill style that actually exists", () => {
  for (const kind of BUSINESS_KINDS) {
    assert.ok(
      TEMPLATE_IDS.includes(kind.template),
      `${kind.id} points at a template that isn't real`,
    );
  }
});

test("a kind is recognised from the seller's own word", () => {
  assert.equal(readBusinessKind("tiffin")!.id, "tiffin");
  assert.equal(readBusinessKind("I run a small restaurant")!.id, "restaurant");
  assert.equal(readBusinessKind("kirana store")!.id, "retail");
  assert.equal(readBusinessKind("something else")!.id, "other");
});

test("a numbered list gets answered with a number", () => {
  assert.equal(readBusinessKind("1"), BUSINESS_KINDS[0]);
  assert.equal(readBusinessKind("3."), BUSINESS_KINDS[2]);
  assert.equal(readBusinessKind("2)"), BUSINESS_KINDS[1]);
});

test("a number past the end of the list is not a kind", () => {
  assert.equal(readBusinessKind("9"), null);
});

test("an unrelated message is not forced into a kind", () => {
  assert.equal(readBusinessKind("Ravi 2 paneer"), null);
  assert.equal(readBusinessKind(""), null);
});

test("a kind button round-trips, and fits Telegram's 64-byte cap", () => {
  for (const kind of BUSINESS_KINDS) {
    const action = encodeKind(kind.id);
    assert.equal(decodeKind(action)!.id, kind.id);
    assert.ok(Buffer.byteLength(action, "utf8") <= 64);
  }
});

test("other actions are not decoded as a kind", () => {
  assert.equal(decodeKind("confirm:1042"), null);
  assert.equal(decodeKind("tpl:food"), null);
  assert.equal(decodeKind("kind:not_a_kind"), null);
});

test("an unknown kind id falls back rather than throwing mid-setup", () => {
  assert.ok(kindById(null).id);
  assert.ok(kindById("deleted_kind").id);
});

// --- Skipping -------------------------------------------------------------

test("every question can be refused", () => {
  for (const word of ["skip", "later", "not now", "nahi", "baad me", "SKIP!"]) {
    assert.ok(isSkip(word), `"${word}" should skip`);
  }
});

test("a skip word inside a real answer does not abandon setup", () => {
  assert.equal(isSkip("skip samosa 20"), false);
  assert.equal(isSkip("no onion pizza 200"), false);
});

test("every question offers a way out", () => {
  const kind = BUSINESS_KINDS[0]!;
  for (const q of [welcomeQuestion(false), nameQuestion(kind), pricesQuestion(kind, "Test")]) {
    assert.ok(
      q.actions?.some((a) => a.action === SKIP_ACTION),
      "a setup question with no skip is a trap",
    );
  }
});

// --- Reading a shop name --------------------------------------------------

test("an ordinary shop name is taken as typed", () => {
  assert.deepEqual(readShopName("Sharma Tiffin Service"), { name: "Sharma Tiffin Service" });
  assert.deepEqual(readShopName("  Anna's   Kitchen  "), { name: "Anna's Kitchen" });
});

test("an order typed at the name step is refused, not printed on every bill", () => {
  // This is the whole reason the guard exists: "Ravi 2 paneer" as a
  // business name is permanent, customer-facing and silent.
  assert.deepEqual(readShopName("Ravi 2 paneer"), { problem: "looks_like_an_order" });
  assert.deepEqual(readShopName("paneer 220 lassi 80"), { problem: "looks_like_an_order" });
});

test("a name that genuinely contains a number still works", () => {
  assert.deepEqual(readShopName("Hotel 24"), { name: "Hotel 24" });
  assert.deepEqual(readShopName("Cafe 24x7"), { name: "Cafe 24x7" });
  assert.deepEqual(readShopName("A1 Sweets"), { name: "A1 Sweets" });
});

test("a refused name has an escape hatch that is honoured verbatim", () => {
  assert.deepEqual(readShopName("shop name Shri 1008 Sweets"), { name: "Shri 1008 Sweets" });
});

test("an empty or oversized name is refused with a reason", () => {
  assert.deepEqual(readShopName("   "), { problem: "empty" });
  assert.deepEqual(readShopName("a".repeat(61)), { problem: "too_long" });
});

test("the name question explains what was wrong with the last answer", () => {
  const kind = BUSINESS_KINDS[0]!;
  assert.match(nameQuestion(kind, "looks_like_an_order").text, /shop name/i);
  assert.match(nameQuestion(kind, "too_long").text, /shorter/i);
});

// --- Billing beats a questionnaire ----------------------------------------

test("an order sent during setup is recognised as one", () => {
  assert.ok(looksLikeAnOrder("Ravi 2 paneer 1 lassi"));
  assert.ok(looksLikeAnOrder("2 dabba"));
});

test("picking option 2 is not mistaken for an order", () => {
  assert.equal(looksLikeAnOrder("2"), false);
  assert.equal(looksLikeAnOrder("tiffin"), false);
});

// --- The finish -----------------------------------------------------------

test("the first order suggested is one the seller's own prices can bill", () => {
  // Suggesting "2 dabba" to someone whose list says "full dabba" hands
  // them a failure on their very first attempt.
  const done = finishedMessage(BUSINESS_KINDS[0]!, "Sharma Tiffin", [
    "full dabba",
    "roti",
    "dal",
  ]);
  assert.ok(done.text.includes("full dabba"));
  assert.ok(done.text.includes("roti"));
  assert.ok(!done.text.includes(BUSINESS_KINDS[0]!.sampleOrder));
  assert.ok(done.text.includes("Sharma Tiffin"));
  assert.match(done.text, /3 items/);
});

test("with no prices saved, the generic example is the fallback", () => {
  for (const kind of BUSINESS_KINDS) {
    assert.ok(finishedMessage(kind, "Shop", []).text.includes(kind.sampleOrder));
  }
});

test("one item is one item, not '1 items'", () => {
  const done = finishedMessage(BUSINESS_KINDS[0]!, "Shop", ["roti"]);
  assert.match(done.text, /1 item\b/);
  assert.ok(done.text.includes("2 roti"));
});

test("the price examples are written in the trade's own words", () => {
  // A tiffin seller shown "sugar 1kg 48" has to translate before answering.
  for (const kind of BUSINESS_KINDS) {
    const q = pricesQuestion(kind, "Shop");
    for (const example of kind.examples) assert.ok(q.text.includes(example));
  }
});

// --- Getting back into setup ----------------------------------------------

test("'setup' reopens setup instead of billing a product called setup", () => {
  assert.equal(classifyIntent("setup").name, "setup");
  assert.equal(classifyIntent("set up").name, "setup");
  assert.equal(classifyIntent("start over").name, "setup");
});

test("a real item named 'setup' is still billable", () => {
  assert.equal(classifyIntent("Ravi 2 setup fee").name, "order");
  assert.equal(classifyIntent("setup 500").name, "order");
});
