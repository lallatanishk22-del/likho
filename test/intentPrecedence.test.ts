import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, looksLikeOrderShape } from "../src/intent.js";

const name = (t: string) => classifyIntent(t).name;

// --- RULE 0: a quantity before a product beats every keyword ------------
//
// 26 keyword rules ran before the order check, so a message whose words
// happened to collide with a keyword was stolen from billing.

test("a customer whose name is a keyword can still order", () => {
  // "sales 2 chai" returned the sales report and the order vanished.
  assert.equal(name("sales 2 chai"), "order");
  assert.equal(name("bill 2 chai"), "order");
});

test("'paid 2 paneer' is an order, not a ₹2 payment", () => {
  // The worst of them: a customer called Paid ordering two paneer was
  // read as a PAYMENT, and the amount taken from the quantity.
  assert.equal(name("paid 2 paneer"), "order");
});

test("noting payment in the same breath as an order keeps the order", () => {
  // Not exotic — this is how people talk.
  assert.equal(name("ravi 2 chai and mark it paid"), "order");
  assert.equal(name("ravi 2 paneer 1 chai paid"), "order");
});

// --- What order shape is, and is not ------------------------------------

test("a quantity before a product is order-shaped", () => {
  for (const t of ["ravi 2 paneer", "2 chai 3 samosa", "tanishk lalla 2 panner"]) {
    assert.ok(looksLikeOrderShape(t), t);
  }
});

test("editing an open bill is NOT order shape", () => {
  // These open with an action verb and must keep their own intent.
  for (const t of ["add 2 samosa", "remove 2 chai", "make it 4 naan", "mark all paid"]) {
    assert.ok(!looksLikeOrderShape(t), t);
  }
});

test("a bill number is not a quantity", () => {
  assert.ok(!looksLikeOrderShape("#1042 paid"));
  assert.equal(name("#1042 paid"), "payment");
});

test("a price is not a quantity", () => {
  assert.ok(!looksLikeOrderShape("ravi paid 500"));
  assert.equal(name("ravi paid 500"), "payment");
});

test("a question is never order-shaped", () => {
  assert.ok(!looksLikeOrderShape("did ravi order 2 chai"));
  assert.ok(!looksLikeOrderShape("how much is 2 chai"));
});

test("a number followed by a unit or price word is not a product", () => {
  assert.ok(!looksLikeOrderShape("discount 10 percent"));
  assert.ok(!looksLikeOrderShape("ravi 500 rs"));
});

test("empty and junk are not orders", () => {
  for (const t of ["", "   ", "?", "!!"]) assert.ok(!looksLikeOrderShape(t), JSON.stringify(t));
});

// --- The whole ordering still holds -------------------------------------
// Rule 0 must not steal anything that was routing correctly.

test("every non-order intent survives the new precedence", () => {
  const expected: [string, string][] = [
    ["done", "confirm"], ["confirm", "confirm"],
    ["ravi paid 500", "payment"], ["#1042 paid", "payment"],
    ["tanishk cleared all his dues", "settle_customer"],
    ["who hasn't paid", "outstanding"], ["unpaid", "outstanding"],
    ["add 2 samosa", "add_item"], ["remove lassi", "remove_item"],
    ["actually paneer was 3", "correction"], ["make it 4 naan", "correction"],
    ["open bills", "open_bills"], ["show bill", "show_bill"],
    ["show #1042", "show_bill"], ["sales", "sales"], ["menu", "prices"],
    ["make pdf", "pdf"], ["lifetime bill of ria", "customer_statement"],
    ["bill format", "bill_format"], ["shop phone 98200", "business_info"],
    ["rename panner to paneer", "rename"], ["forget paner", "forget"],
    ["what have you learned", "learned"], ["hi", "greeting"], ["help", "help"],
  ];
  for (const [message, want] of expected) {
    assert.equal(name(message), want, `"${message}" should be ${want}`);
  }
});
