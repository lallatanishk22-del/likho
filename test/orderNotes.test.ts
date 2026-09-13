import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyNote, dedupeNotes, CATEGORY_LABEL } from "../src/orderNotes.js";
import { parseOrderExtras } from "../src/orderExtras.js";
import { renderNotesLine } from "../src/billRender.js";

// A bill is the record of a transaction, and "no onion, deliver by 8pm" IS
// part of that transaction. It used to reach the model as part of the
// order, produce no item, and vanish — leaving the seller to remember it
// and tell the kitchen by hand, which is the exact work Likho removes.

const noProducts = () => false;
const note = (line: string) => classifyNote(line, noProducts);
const cat = (line: string) => note(line)?.category ?? null;

// --- The categories ------------------------------------------------------

test("how it should be cooked is Prep", () => {
  for (const line of [
    "less spicy", "not too spicy", "no onion", "extra spicy",
    "bina pyaaz", "kam mirchi", "jain", "no garlic", "less oil",
  ]) {
    assert.equal(cat(line), "prep", line);
  }
});

test("when, and how fast, is Timing", () => {
  for (const line of [
    "fast delivery", "deliver by 8pm", "urgent", "asap", "jaldi bhejna",
    "7 baje tak", "before 9", "tomorrow morning", "kal shaam",
  ]) {
    assert.equal(cat(line), "timing", line);
  }
});

test("how it should be packed is Packing", () => {
  for (const line of ["pack separately", "parcel", "alag pack karna", "extra spoons"]) {
    assert.equal(cat(line), "packing", line);
  }
});

test("where it goes is Delivery", () => {
  for (const line of ["home delivery", "flat B wing", "leave at the gate", "office address"]) {
    assert.equal(cat(line), "delivery", line);
  }
});

test("an explicitly marked line is always kept", () => {
  // The escape hatch for anything the categories do not recognise.
  assert.deepEqual(note("note: ring the bell twice"), { category: "note", text: "ring the bell twice" });
  assert.deepEqual(note("special - call on arrival"), { category: "note", text: "call on arrival" });
});

test("every category has a heading to print under", () => {
  for (const c of ["prep", "timing", "packing", "delivery", "note"] as const) {
    assert.ok(CATEGORY_LABEL[c].length > 0, c);
  }
});

// --- WHAT MUST NEVER BECOME A NOTE ---------------------------------------
//
// The first version captured the whole remainder and read "pooja" — the
// customer — as a note, producing an anonymous bill. A bill with no name
// can never be looked up, chased for payment, or counted toward what
// someone owes.

test("a customer name is never captured as a note", () => {
  for (const name of ["pooja", "ravi", "ria bhanushali", "suresh kumar", "Rahul"]) {
    assert.equal(note(name), null, `"${name}" was taken as a note`);
  }
});

test("a line with money on it is never a note", () => {
  // Losing an item into the notes column is far worse than losing a note.
  for (const line of ["3 thali 150", "2 paneer 120", "delivery 50", "10% off"]) {
    assert.equal(note(line), null, line);
  }
});

test("a product name is never a note, even when it reads like an instruction", () => {
  // A shop that sells "extra spicy paneer" must bill it, not annotate it.
  const sells = (p: string) => p === "extra spicy paneer";
  assert.equal(classifyNote("extra spicy paneer", sells), null);
  assert.equal(classifyNote("extra spicy", sells)?.category, "prep");
});

test("chatter aimed at Likho is not an instruction to the kitchen", () => {
  for (const line of ["total batao", "bill banao", "kitna hua", "ok", "thanks", "thik hai"]) {
    assert.equal(note(line), null, line);
  }
});

test("a line that is only PART chatter is kept whole", () => {
  // Losing an instruction is worse than printing a stray "please".
  assert.equal(cat("please pack separately"), "packing");
});

// --- A clock time is not money -------------------------------------------

test("a time keeps its line as an instruction", () => {
  assert.equal(cat("deliver by 8pm"), "timing");
  assert.equal(cat("7 baje tak"), "timing");
  assert.equal(cat("by 9 please"), "timing");
});

// --- Through the extractor ------------------------------------------------

test("the reported order yields items, a charge and notes at once", () => {
  const e = parseOrderExtras(
    "pooja\n3 thali 150\n2 paneer 120\nless spicy\nhome delivery 50\ndeliver by 8pm\ntotal batao",
  );
  assert.deepEqual(e.charges, [{ label: "Delivery", amount: 50 }]);
  assert.deepEqual(e.notes, [
    { category: "prep", text: "less spicy" },
    { category: "timing", text: "deliver by 8pm" },
  ]);
  // The customer and the item lines still reach the extractor untouched.
  assert.equal(e.rest, "pooja\n3 thali 150\n2 paneer 120\ntotal batao");
});

test("an ordinary order produces no notes at all", () => {
  for (const t of ["ravi 2 paneer 3 chai", "2 paneer tikka 180\n1 butter naan 40"]) {
    assert.deepEqual(parseOrderExtras(t).notes, [], t);
  }
});

test("the same instruction typed twice appears once", () => {
  assert.deepEqual(
    dedupeNotes([
      { category: "prep", text: "less spicy" },
      { category: "prep", text: "Less Spicy" },
      { category: "timing", text: "urgent" },
    ]),
    [{ category: "prep", text: "less spicy" }, { category: "timing", text: "urgent" }],
  );
});

// --- On the document ------------------------------------------------------

test("notes render grouped by heading for the PDF templates", () => {
  const line = renderNotesLine([
    { category: "prep", text: "less spicy" },
    { category: "prep", text: "no onion" },
    { category: "timing", text: "deliver by 8pm" },
  ]);
  assert.ok(line!.includes("Prep: less spicy; no onion"));
  assert.ok(line!.includes("Timing: deliver by 8pm"));
});

test("a bill with no instructions carries no notes block", () => {
  assert.equal(renderNotesLine([]), null);
});
