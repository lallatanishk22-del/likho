import { test } from "node:test";
import assert from "node:assert/strict";
import { matchChoice, type ChoiceOption } from "../src/pendingChoice.js";

// Answering the question Likho just asked, in words.
//
// Every question could previously be answered only by TAPPING, or by the
// one phrasing that had a regex behind it. Asked "cake or caku?", a seller
// typing "cake", "drop caku", "the first one" or "caku hata do" got none
// of them — two of ten natural answers worked.
//
// Same mistake as guessing which words are filler in a customer question,
// and the same fix: THE OPTIONS ARE KNOWN. Match against what was actually
// offered and no phrasing has to be guessed.

const OPTIONS: ChoiceOption[] = [
  { label: 'Keep "caku"', action: "merge:cake", value: "caku" },
  { label: 'Keep "cake"', action: "merge:caku", value: "cake" },
];

const chose = (t: string): string | null => {
  const m = matchChoice(t, OPTIONS);
  return m.kind === "chosen" ? m.option.value : null;
};

test("naming an option picks it", () => {
  assert.equal(chose("cake"), "cake");
  assert.equal(chose("caku"), "caku");
});

test("an exact name beats a near one", () => {
  // "cake" is one letter from "caku", so both matched, it counted as two
  // hits, and the answer was refused. An exact match now wins outright.
  assert.equal(chose("cake"), "cake");
  assert.equal(chose("caku"), "caku");
});

test("the phrasings a seller actually uses", () => {
  assert.equal(chose("keep only cake"), "cake");
  assert.equal(chose("keep cake"), "cake");
  assert.equal(chose("cake is right"), "cake");
});

test("a rejecting word picks the OTHER option", () => {
  // "drop caku" names caku and means keep cake.
  assert.equal(chose("drop caku"), "cake");
  assert.equal(chose("no caku"), "cake");
  assert.equal(chose("caku hata do"), "cake");
  assert.equal(chose("remove cake"), "caku");
});

test("positional answers work", () => {
  assert.equal(chose("the first one"), "caku");
  assert.equal(chose("second one"), "cake");
  assert.equal(chose("1"), "caku");
  assert.equal(chose("2"), "cake");
});

test("'second one' is not read as the first", () => {
  // "one"/"two" were ordinals at first, so "the second one" contained
  // "one" and selected option 1. Only real ordinals count now.
  assert.equal(chose("the second one"), "cake");
});

// --- Nothing is ever blocked behind a question --------------------------

test("an order is never an answer", () => {
  // A quantity before a product means the seller has moved on to billing.
  assert.equal(chose("ravi 2 chai"), null);
  assert.equal(chose("2 cake"), null);
  assert.equal(chose("cake 2"), null);
});

test("an unrelated message is not an answer", () => {
  assert.equal(chose("sales"), null);
  assert.equal(chose("who hasn't paid"), null);
  assert.equal(chose("hi"), null);
});

test("a message naming neither option is not an answer", () => {
  assert.equal(chose("samosa"), null);
  assert.equal(chose("whatever"), null);
});

test("an empty message is not an answer", () => {
  assert.equal(chose(""), null);
  assert.equal(chose("   "), null);
});

test("no options means no match", () => {
  assert.equal(matchChoice("cake", []).kind, "none");
});

// --- Refusing rather than guessing --------------------------------------

test("a rejecting word with more than two options refuses", () => {
  // "not cake" among three says what it is NOT, which does not identify
  // one answer.
  const three: ChoiceOption[] = [
    ...OPTIONS,
    { label: 'Keep "kake"', action: "merge:x", value: "kake" },
  ];
  const m = matchChoice("not cake", three);
  assert.equal(m.kind, "none");
});

test("a message naming BOTH options refuses", () => {
  assert.equal(chose("cake or caku"), null);
});
