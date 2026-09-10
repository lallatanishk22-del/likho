import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent } from "../src/intent.js";

const name = (t: string) => classifyIntent(t).name;

// --- The core promise: normal typing is an order, no command needed -----

test("a bare order is an order", () => {
  assert.equal(name("Ravi 2 paneer 1 lassi"), "order");
});

test("an order with no customer is still an order", () => {
  assert.equal(name("2 paneer 3 samosa"), "order");
});

test("a Hinglish bill request is an order", () => {
  assert.equal(name("Ravi ka bill bana 2 paneer"), "order");
});

test("a multi-line pasted order is an order", () => {
  assert.equal(name("2 paneer tikka\n3 naan\n2 coke\nRahul"), "order");
});

// --- Payment must NOT be read as an order ------------------------------
// "Ravi paid 500" has a name and a number; without this check it would
// look exactly like an order and invent a bill for 500 rupees of nothing.

test("'Ravi paid 500' is a payment, not an order", () => {
  const intent = classifyIntent("Ravi paid 500");
  assert.equal(intent.name, "payment");
  assert.equal(intent.amount, 500);
});

test("'#1042 paid' is a payment against that specific bill", () => {
  const intent = classifyIntent("#1042 paid");
  assert.equal(intent.name, "payment");
  assert.equal(intent.billNo, 1042);
  // The bill number is not the amount paid.
  assert.equal(intent.amount, null);
});

test("payment with no amount means paid in full", () => {
  const intent = classifyIntent("Ravi paid");
  assert.equal(intent.name, "payment");
  assert.equal(intent.amount, null);
});

test("a rupee-prefixed amount is read", () => {
  assert.equal(classifyIntent("ravi paid ₹450").amount, 450);
});

// --- Corrections change the open bill, they don't start a new one ------

test("'actually paneer was 3' is a correction", () => {
  assert.equal(name("actually paneer was 3"), "correction");
});

test("'make it 4 naan' is a correction", () => {
  assert.equal(name("make it 4 naan"), "correction");
});

test("'change lassi to 2' is a correction", () => {
  assert.equal(name("change lassi to 2"), "correction");
});

// --- Reading vs creating ------------------------------------------------

test("'show #1042' reads a bill", () => {
  const intent = classifyIntent("show #1042");
  assert.equal(intent.name, "show_bill");
  assert.equal(intent.billNo, 1042);
});

test("a bare bill number reads that bill", () => {
  assert.equal(name("#1042"), "show_bill");
});

test("'show bill' reads the open bill", () => {
  assert.equal(name("show bill"), "show_bill");
});

// --- Everything else ----------------------------------------------------

test("greetings do not create bills", () => {
  for (const greeting of ["hi", "hello", "hey", "namaste", "thanks", "ok"]) {
    assert.equal(name(greeting), "greeting", `"${greeting}" should be a greeting`);
  }
});

test("'ok 2 paneer' is an order, not an acknowledgement", () => {
  // The length/digit guard matters: a pleasantry followed by a real order
  // must still bill.
  assert.equal(name("ok 2 paneer"), "order");
});

test("'confirm' and 'done' close the bill", () => {
  assert.equal(name("confirm"), "confirm");
  assert.equal(name("done"), "confirm");
});

test("'sales' asks for today's total", () => {
  assert.equal(name("sales"), "sales");
});

test("'menu' and 'rates' show the price list", () => {
  assert.equal(name("menu"), "prices");
  assert.equal(name("rates"), "prices");
});

test("'make pdf' asks for a PDF", () => {
  assert.equal(name("make pdf"), "pdf");
});

test("help is help", () => {
  assert.equal(name("help"), "help");
});

// --- Word-boundary safety ----------------------------------------------

test("'unpaid' does not trigger payment", () => {
  assert.notEqual(name("unpaid bills"), "payment");
});

test("an order containing a product with digits still bills", () => {
  assert.equal(name("2 thums up 40"), "order");
});

// --- Editing the open bill must not reach the order parser -------------
// "add 2 samosa" sent to the model produced "What is the quantity and
// price of the samosa?" — it treated a one-line edit as a whole new order.

test("'add 2 samosa' edits the bill, it is not a new order", () => {
  const intent = classifyIntent("add 2 samosa");
  assert.equal(intent.name, "add_item");
  assert.equal(intent.text, "2 samosa");
});

test("'plus 1 lassi' edits the bill", () => {
  assert.equal(classifyIntent("plus 1 lassi").name, "add_item");
});

test("'remove chutney' removes from the bill", () => {
  const intent = classifyIntent("remove chutney");
  assert.equal(intent.name, "remove_item");
  assert.equal(intent.text, "chutney");
});

test("'hata do samosa' removes from the bill", () => {
  assert.equal(classifyIntent("hata do samosa").name, "remove_item");
});

test("a normal order starting with a name is still an order", () => {
  // Guard against the add/remove patterns being too greedy.
  assert.equal(classifyIntent("Adarsh 2 paneer").name, "order");
});

// --- Open (unconfirmed) bills ------------------------------------------
// These must not fall through to "sales" or "show_bill".

test("'open bills' lists unconfirmed bills", () => {
  assert.equal(name("open bills"), "open_bills");
});

test("'pending bills' lists unconfirmed bills", () => {
  assert.equal(name("pending bills"), "open_bills");
});

test("'show open bills' still lists them, not one bill", () => {
  assert.equal(name("show open bills"), "open_bills");
});

test("'sales' is still sales", () => {
  assert.equal(name("sales"), "sales");
});
