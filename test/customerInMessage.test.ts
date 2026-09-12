import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCustomer } from "../src/customerStore.js";
import { stripDateExpressions } from "../src/businessDay.js";

// findCustomerInMessage reads the database, so these exercise the pure
// pieces it is built from — the same resolution and the same windowing —
// against the phrasings that broke two earlier attempts.

const CUSTOMERS = [
  { id: "c1", name: "Ravi" },
  { id: "c2", name: "Ria Bhanushali" },
  { id: "c3", name: "Amit" },
];

// Mirrors findCustomerInMessage's windowing: 3-word phrases, then 2, then 1,
// stopping at the longest size that matched anything.
function scan(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\s'’]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);

  for (const size of [3, 2, 1]) {
    const hits = new Map<string, string>();
    for (let i = 0; i + size <= words.length; i++) {
      const match = resolveCustomer(CUSTOMERS, words.slice(i, i + size).join(" "));
      if (match.kind === "found") hits.set(match.customer.id, match.customer.name);
    }
    if (hits.size > 0) return [...hits.values()];
  }
  return [];
}

// --- Every phrasing that has failed in real use -------------------------
//
// Two earlier versions tried to strip FILLER words and treat the remainder
// as a name. Each fix added words to a list and waited for the next word
// nobody thought of: "dude", then "yesterday", then "total". English has no
// end of them. Scanning for names the seller actually HAS needs no such list.

test("'can you get me bills total of ravi' finds Ravi", () => {
  assert.deepEqual(scan("can you get me bills total of ravi"), ["Ravi"]);
});

test("'dude get me bill of ravi' finds Ravi", () => {
  assert.deepEqual(scan("dude get me bill of ravi"), ["Ravi"]);
});

test("'bring me yesterday bill of ravi' finds Ravi", () => {
  assert.deepEqual(scan(stripDateExpressions("bring me yesterday bill of ravi")), ["Ravi"]);
});

test("'total spent by ravi' finds Ravi", () => {
  assert.deepEqual(scan("total spent by ravi"), ["Ravi"]);
});

test("'kitna hua ravi ka' finds Ravi", () => {
  assert.deepEqual(scan("kitna hua ravi ka"), ["Ravi"]);
});

test("'how much has ravi spent till date' finds Ravi", () => {
  assert.deepEqual(scan("how much has ravi spent till date"), ["Ravi"]);
});

test("a bare name finds them", () => {
  assert.deepEqual(scan("ravi"), ["Ravi"]);
});

test("a phrasing nobody has thought of still works", () => {
  // The point of the approach: it was never taught any of these words.
  assert.deepEqual(scan("yo boss whats the damage on ravi"), ["Ravi"]);
  assert.deepEqual(scan("pull up everything for ravi please"), ["Ravi"]);
});

// --- A full name beats the first name inside it ------------------------

test("'ria bhanushali' resolves to the full name, not a partial", () => {
  assert.deepEqual(scan("bill of ria bhanushali"), ["Ria Bhanushali"]);
});

test("a longer window wins, so one person is not counted as two", () => {
  assert.equal(scan("ria bhanushali total").length, 1);
});

// --- Refusing rather than guessing --------------------------------------

test("two different customers named in one message is ambiguous", () => {
  const found = scan("bills of ravi and amit");
  assert.equal(found.length, 2, "should surface both rather than pick one");
});

test("a message naming nobody finds nobody", () => {
  assert.deepEqual(scan("what is my total sales"), []);
  assert.deepEqual(scan("show me the price list"), []);
});

test("an empty message finds nobody", () => {
  assert.deepEqual(scan(""), []);
  assert.deepEqual(scan("   "), []);
});
