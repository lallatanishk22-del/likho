import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, isQuestion } from "../src/intent.js";

const name = (t: string) => classifyIntent(t).name;

// --- THE RULE: a question is answered, never acted on -------------------
//
// "dude did i confirm tanishks bill" was routed to CONFIRM. A seller
// checking whether something happened was about to make it happen — and
// the parser had even taken "dude did tanishks" as the customer name.
//
// Checking your records must never change them.

test("'did i confirm tanishks bill' does not confirm anything", () => {
  assert.notEqual(name("dude did i confirm tanishks bill"), "confirm");
  assert.notEqual(name("did i confirm tanishk bill"), "confirm");
});

test("a question never reaches a money-changing intent", () => {
  const MUTATING = ["confirm", "payment", "settle_customer", "correction", "add_item", "remove_item", "rename", "forget"];
  for (const question of [
    "did i confirm tanishks bill",
    "did ravi pay",
    "has tanishk paid",
    "is ravi's bill settled",
    "did i mark all bills paid",
    "have i added chai",
    "should i remove lassi",
    "was tanishk cleared",
    "kya tanishk ne diya",
    "how much did ravi pay",
  ]) {
    assert.ok(
      !MUTATING.includes(name(question)),
      `"${question}" reached ${name(question)} — a question changed money`,
    );
  }
});

test("the garbage customer name is dropped, not carried into the answer", () => {
  // "dude did tanishks" was being used as a customer name. The handler
  // rescans the message instead.
  const intent = classifyIntent("dude did i confirm tanishks bill");
  assert.equal(intent.customer, null);
});

test("a question about a specific bill still opens that bill", () => {
  const intent = classifyIntent("did i confirm #1042");
  assert.equal(intent.name, "show_bill");
  assert.equal(intent.billNo, 1042);
});

// --- Statements still act ------------------------------------------------
// The guard must not make the bot passive: telling it something still works.

test("a statement still confirms, pays and settles", () => {
  assert.equal(name("confirm"), "confirm");
  assert.equal(name("done"), "confirm");
  assert.equal(name("ravi paid 500"), "payment");
  assert.equal(name("#1042 paid"), "payment");
  assert.equal(name("tanishk cleared all his dues"), "settle_customer");
  assert.equal(name("mark all bills of tanishk as paid"), "settle_customer");
});

test("an order is never treated as a question", () => {
  assert.equal(name("ravi 2 paneer 1 chai"), "order");
  assert.equal(name("2 chai 3 samosa"), "order");
});

// --- What counts as a question ------------------------------------------

test("interrogatives are recognised", () => {
  for (const q of [
    "did i confirm",
    "has ravi paid",
    "is this right?",
    "how much is due",
    "what did ravi order",
    "kitna hua",
    "kya ravi ne diya",
    "dude did i pay",
    "anything pending?",
  ]) {
    assert.ok(isQuestion(q), `"${q}" was not read as a question`);
  }
});

test("plain statements are not questions", () => {
  for (const s of [
    "ravi 2 paneer",
    "confirm",
    "done",
    "ravi paid 500",
    "tanishk cleared all his dues",
    "/add paneer 220",
  ]) {
    assert.ok(!isQuestion(s), `"${s}" was wrongly read as a question`);
  }
});

test("a trailing question mark alone makes it a question", () => {
  assert.ok(isQuestion("ravi paid?"));
  assert.ok(!isQuestion("ravi paid"));
});

// --- The set must not go stale ------------------------------------------
//
// "did i add 10 percent discount" APPLIED one, because set_discount was a
// new intent and nobody added it to MUTATING. A new state-changing intent
// that is left out silently loses the guard.

test("every state-changing intent is covered by the guard", () => {
  // Each of these, phrased as a question, must NOT reach its own intent.
  const asQuestions: [string, string][] = [
    ["did i add 10 percent discount", "set_discount"],
    ["did i keep only cake", "keep_only"],
    ["did i confirm the bill", "confirm"],
    ["has ravi paid", "payment"],
    ["did i settle tanishk", "settle_customer"],
    ["did i add 2 chutney", "add_item"],
    ["did i remove lassi", "remove_item"],
    ["did i rename panner", "rename"],
    ["have i forgotten paner", "forget"],
  ];
  for (const [question, mustNotBe] of asQuestions) {
    assert.notEqual(
      classifyIntent(question).name,
      mustNotBe,
      `"${question}" reached ${mustNotBe} — a question changed state`,
    );
  }
});

// --- Remembered context must not answer a shop-wide question ------------
//
// "who hasn't paid" returned one customer's history, because the message
// named nobody and the last-discussed customer was used as a fallback. But
// "who" IS the question — it asks across everyone. Answering it about one
// person is a worse error than not remembering at all.

test("'who' asks across everyone, so context cannot narrow it", () => {
  for (const q of ["who hasn't paid", "who owes me", "kaun baaki hai", "who has not paid"]) {
    assert.equal(classifyIntent(q).name, "outstanding", q);
  }
});

test("a follow-up with no 'who' can still use context", () => {
  // "how much is the due amt" after discussing someone is about them.
  assert.equal(classifyIntent("okay how much is the due amt").name, "outstanding");
  // ...and the handler decides, since only it knows who was discussed.
});
