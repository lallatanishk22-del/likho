// Defects found by the 12 Oct 2026 audit — every one in work shipped the
// same day. Named after what broke, not the code that broke it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeReportRequest, looksLikeOrderLines } from "../src/messageHandler.js";
import { classifyError } from "../src/sellerError.js";
import { parseDateRange } from "../src/businessDay.js";

test("an order that mentions a day and a bill is still an order", () => {
  for (const t of ["aaj ka bill 2 momos ₹50", "Rahul 2 din ka tiffin bill ₹100", "kal ka bill 3 thali", "today bill 2 chai"]) {
    assert.equal(looksLikeReportRequest(t), false, t);
  }
});

test("a report request is still a report", () => {
  for (const t of ["2 months bill", "rahul 2 months bill", "sales 14 sept", "september sales", "2025 sales", "aaj ka total", "sales on 13/9/2026", "last 3 months", "this week", "september"]) {
    assert.equal(looksLikeReportRequest(t), true, t);
  }
});

test("after a bare /add, an order typed next is not saved as a price", () => {
  for (const t of ["Rahul 2 samosa", "2 samosa 1 chai", "paneer 220\nRahul 2 chai"]) {
    assert.equal(looksLikeOrderLines(t), true, t);
  }
  for (const t of ["paneer 220", "paneer tikka 180\nchai 15", "chai 15 rs", "samosa 20 each", "lassi 40/-"]) {
    assert.equal(looksLikeOrderLines(t), false, t);
  }
});

test("a product name never makes a question look like a system failure", () => {
  assert.equal(classifyError('No price found for "network cable". Please state the price, e.g. "network cable ₹100 each".'), "seller");
  assert.equal(classifyError('No price found for "model car". Please state the price.'), "seller");
  assert.equal(classifyError('No price found for "null pointer t-shirt".'), "seller");
  // …while real failures are still caught outside the quotes.
  assert.equal(classifyError('Supabase request failed (409): {"message":"duplicate key value"}'), "generic");
  assert.equal(classifyError("fetch failed"), "connection");
});

test("a report button for a past year reopens that year, not this one", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  const r = parseDateRange("sales 13/9/2025", now)!;
  const back = parseDateRange(r.label, now)!;
  assert.equal(r.label, "13 Sept 2025");
  assert.equal(back.from.getTime(), r.from.getTime());
});

test("a name before an item-then-quantity order is kept", async () => {
  const { leadingCustomerName } = await import("../src/leadingName.js");
  // Like the real matcher: a phrase that CONTAINS a product also matches.
  const catalog = ["chai", "samosa", "kachori", "silver", "rose milk"];
  const sells = (p: string) => catalog.some((c) => ` ${p} `.includes(` ${c} `));
  assert.equal(leadingCustomerName("Tanishk chai 1 samosa 2 kachori 3 discount 15%", sells), "Tanishk");
  assert.equal(leadingCustomerName("pankay silver 5", sells), "Pankay");
  assert.equal(leadingCustomerName("chai 1 samosa 2", sells), null, "a product first names nobody");
  assert.equal(leadingCustomerName("rose milk 2", sells), null, "a two-word product is not a name");
});

test("a name at the end of the order is kept, not dropped", async () => {
  const { trailingCustomerName } = await import("../src/leadingName.js");
  const catalog = ["cake", "chai", "samosa", "mudpie", "paneer tikka"];
  const sells = (p: string) => catalog.some((c) => ` ${p} `.includes(` ${c} `));
  const exact = (p: string) => catalog.includes(p);
  const t = (m: string) => trailingCustomerName(m, sells, exact);
  assert.equal(t("cake 2 fenil"), "Fenil");
  assert.equal(t("3 mudpie ria bhanushali"), "Ria Bhanushali");
  assert.equal(t("2 chai for rahul"), "Rahul");
  assert.equal(t("2 paneer tikka 1 chai rahul"), "Rahul");
  assert.equal(t("2 chai\n3 samosa\nRahul"), "Rahul");
});

test("order words and products at the end are never taken as a name", async () => {
  const { trailingCustomerName } = await import("../src/leadingName.js");
  const catalog = ["cake", "chai", "samosa", "paneer tikka"];
  const sells = (p: string) => catalog.some((c) => ` ${p} `.includes(` ${c} `));
  for (const t of [
    "2 chai 3 samosa", "chai 2 samosa 3", "2 chai garam", "3 chai bhej do", "2 paneer tikka chahiye",
    "2 samosa extra spicy", "1 cake 500 rs", "2 chai each", "2 chai aaj", "rahul ka bill", "2 cake 1 kg",
  ]) {
    assert.equal(trailingCustomerName(t, sells, (p) => catalog.includes(p)), null, t);
  }
});
