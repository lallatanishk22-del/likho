import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCustomer, resolveCustomer, normalizeCustomerName } from "../src/customerStore.js";

// Which customer "open ravi bill" means. The bug being guarded: nothing
// read the name at all, so the seller asking for Ravi's bill was shown
// whatever draft was open — a different customer's transaction, complete
// with a Mark Paid button.

const customers = (...names: string[]) => names.map((name) => ({ name }));

test("the named customer is found", () => {
  const found = pickCustomer(customers("Tanishk Lalla", "Ravi"), "ravi");
  assert.equal(found?.name, "Ravi");
});

test("an unknown name resolves to nobody, not to the only customer there is", () => {
  assert.equal(pickCustomer(customers("Tanishk Lalla"), "ravi"), null);
});

test("no customers at all resolves to nobody", () => {
  assert.equal(pickCustomer([], "ravi"), null);
});

test("a first name finds the fuller record", () => {
  const found = pickCustomer(customers("Tanishk Lalla", "Ravi Jerath"), "ravi");
  assert.equal(found?.name, "Ravi Jerath");
});

test("an exact match beats a first-name match", () => {
  const found = pickCustomer(customers("Ravi Jerath", "Ravi"), "ravi");
  assert.equal(found?.name, "Ravi");
});

test("case and punctuation don't matter", () => {
  assert.equal(pickCustomer(customers("RAVI."), "ravi")?.name, "RAVI.");
});

test("a typo still finds the customer", () => {
  const found = pickCustomer(customers("Tanishk Lalla", "Rakesh"), "rakseh");
  assert.equal(found?.name, "Rakesh");
});

// Safety: near-matching may never pick between two equally close people.
test("a typo equally close to two customers resolves to neither", () => {
  assert.equal(pickCustomer(customers("Rami", "Ravi"), "rani"), null);
});

test("a fuller name never matches a bare first name", () => {
  assert.equal(pickCustomer(customers("Ravi"), "ravi jerath"), null);
});

test("an empty name matches nobody", () => {
  assert.equal(pickCustomer(customers("Ravi"), "   "), null);
});

// The normalizer must keep producing what the migration's backfill wrote,
// or a customer created before this landed could never be found again.
test("normalization matches the backfill: lowercase, punctuation out, spaces collapsed", () => {
  assert.equal(normalizeCustomerName("  Ravi   Jerath! "), "ravi jerath");
  assert.equal(normalizeCustomerName("RAVI."), "ravi");
});

test("a typo on a first name reaches the fuller record", () => {
  const found = pickCustomer(customers("Tanishk Lalla", "Ravi Jerath"), "rvai");
  assert.equal(found?.name, "Ravi Jerath");
});

// Two people who share a first name make that first name useless as an
// address — resolving it either way would put money on a coin toss.
test("a first name shared by two customers resolves to neither, even exactly", () => {
  assert.equal(pickCustomer(customers("Ravi Jerath", "Ravi Kumar"), "ravi"), null);
});

test("a typo on a shared first name resolves to neither", () => {
  assert.equal(pickCustomer(customers("Ravi Jerath", "Ravi Kumar"), "rvai"), null);
});

test("the full name still works when the first name is shared", () => {
  const found = pickCustomer(customers("Ravi Jerath", "Ravi Kumar"), "ravi kumar");
  assert.equal(found?.name, "Ravi Kumar");
});

// --- Ambiguous is not the same as absent ------------------------------
// Telling a seller "I don't have a bill for Ravi" when they have two Ravis
// reads as data loss. These two cases need opposite replies, so they are
// distinct kinds rather than a shared null.

test("two customers sharing a first name report as ambiguous, with both names", () => {
  const match = resolveCustomer(customers("Ravi Jerath", "Ravi Kumar"), "ravi");
  assert.equal(match.kind, "ambiguous");
  assert.deepEqual(
    match.kind === "ambiguous" ? match.candidates.map((c) => c.name).sort() : [],
    ["Ravi Jerath", "Ravi Kumar"],
  );
});

test("a typo onto a shared first name is ambiguous, not absent", () => {
  const match = resolveCustomer(customers("Ravi Jerath", "Ravi Kumar"), "rvai");
  assert.equal(match.kind, "ambiguous");
});

test("a genuinely unknown name is absent, not ambiguous", () => {
  assert.equal(resolveCustomer(customers("Ravi Jerath", "Ravi Kumar"), "suresh").kind, "none");
});

test("one clear answer is found, not ambiguous", () => {
  const match = resolveCustomer(customers("Ravi Jerath", "Meera"), "ravi");
  assert.equal(match.kind, "found");
  assert.equal(match.kind === "found" ? match.customer.name : null, "Ravi Jerath");
});

test("the full name resolves even while the first name is ambiguous", () => {
  const match = resolveCustomer(customers("Ravi Jerath", "Ravi Kumar"), "ravi kumar");
  assert.equal(match.kind, "found");
});
