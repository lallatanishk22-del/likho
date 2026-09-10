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

// --- Sales for a period -------------------------------------------------

test("'yesterday sales' asks for sales, not an order", () => {
  assert.equal(name("yesterday sales"), "sales");
});

test("'sales 8 sep' is a sales question despite the digits", () => {
  assert.equal(name("sales 8 sep"), "sales");
});

test("'this month sales' is a sales question", () => {
  assert.equal(name("this month sales"), "sales");
});

test("a date in a sales question does not make it an order", () => {
  assert.notEqual(name("sales 8/9"), "order");
});

// --- Naming a customer ------------------------------------------------
// The bug this fixes: "open ravi bill" showed the bill that happened to be
// open (a different customer's #1009), because nothing read the name at
// all. A named customer is now carried through to the lookup.

test("'open ravi bill' names ravi", () => {
  const intent = classifyIntent("open ravi bill");
  assert.equal(intent.name, "show_bill");
  assert.equal(intent.customer, "ravi");
});

test("'open ravi jerath bill' keeps the full name", () => {
  assert.equal(classifyIntent("open ravi jerath bill").customer, "ravi jerath");
});

// The seller's own capitalisation survives, because it becomes the stored
// customer record's name. Matching lowercases later; the record does not.
test("'show Ravi's bill' names Ravi, with their capitalisation kept", () => {
  assert.equal(classifyIntent("show Ravi's bill").customer, "Ravi");
});

test("'ravi ka bill dikha' names ravi", () => {
  assert.equal(classifyIntent("ravi ka bill dikha").customer, "ravi");
});

test("'show bill' names nobody, so the current draft still resolves", () => {
  const intent = classifyIntent("show bill");
  assert.equal(intent.name, "show_bill");
  assert.equal(intent.customer, null);
});

test("'show #1042' names nobody — the number is the address", () => {
  const intent = classifyIntent("show #1042");
  assert.equal(intent.billNo, 1042);
  assert.equal(intent.customer, null);
});

test("'Ravi paid 500' names ravi and keeps the amount", () => {
  const intent = classifyIntent("Ravi paid 500");
  assert.equal(intent.name, "payment");
  assert.equal(intent.amount, 500);
  assert.equal(intent.customer, "Ravi");
});

test("'#1042 paid' names nobody, so the number decides which bill", () => {
  const intent = classifyIntent("#1042 paid");
  assert.equal(intent.name, "payment");
  assert.equal(intent.customer, null);
});

test("'paid 500' with no name leaves the customer null", () => {
  assert.equal(classifyIntent("paid 500").customer, null);
});

test("a name is never invented from a long sentence", () => {
  assert.equal(classifyIntent("show me the last bill i made please").customer, null);
});

test("'confirm ravi bill' names ravi", () => {
  const intent = classifyIntent("confirm ravi bill");
  assert.equal(intent.name, "confirm");
  assert.equal(intent.customer, "ravi");
});

test("'ravi bill pdf' names ravi", () => {
  const intent = classifyIntent("ravi bill pdf");
  assert.equal(intent.name, "pdf");
  assert.equal(intent.customer, "ravi");
});

// --- Naming a bill that has no customer -------------------------------
// Most bills are typed without a name ("2 paneer 1 lassi"), which left
// them anonymous forever: unlookupable, unchaseable, invisible to any
// question about what a customer owes.

test("'this is ravi' names the open bill", () => {
  const intent = classifyIntent("this is ravi");
  assert.equal(intent.name, "set_customer");
  assert.equal(intent.customer, "ravi");
});

test("'customer ravi jerath' names the open bill", () => {
  const intent = classifyIntent("customer ravi jerath");
  assert.equal(intent.name, "set_customer");
  assert.equal(intent.customer, "ravi jerath");
});

test("'ravi ka hai' names the open bill", () => {
  const intent = classifyIntent("ravi ka hai");
  assert.equal(intent.name, "set_customer");
  assert.equal(intent.customer, "ravi");
});

test("'#1042 is ravi' names that specific bill", () => {
  const intent = classifyIntent("#1042 this is ravi");
  assert.equal(intent.name, "set_customer");
  assert.equal(intent.billNo, 1042);
});

// The guard that keeps naming from swallowing orders.
test("'this is 2 paneer' is an order, not a customer name", () => {
  assert.equal(name("this is 2 paneer"), "order");
});

test("naming never fires on a plain order", () => {
  assert.equal(name("Ravi 2 paneer 1 lassi"), "order");
});

test("naming never fires on an item edit", () => {
  assert.equal(name("add 2 samosa"), "add_item");
});

// --- Naming must never swallow an order -------------------------------
// The failure mode this guards is silent and expensive: a message that
// should have become a bill gets read as "name the customer" instead, and
// the order is simply lost. Every routing decision that existed before
// customer naming was added must still land where it did.

for (const order of [
  "Ravi 2 paneer 1 lassi",
  "2 paneer 3 naan",
  "ravi ka bill bana 2 paneer",
  "this is 2 paneer",
  "name 2 chai",
  "its 3 samosa",
  "customer 2 lassi",
  "2 paneer tikka\n3 naan\nRahul",
  "rahul - 2 paneer, 3 naan",
  "meera 5 dabba 180 each",
]) {
  test(`still an order: ${JSON.stringify(order)}`, () => {
    assert.equal(name(order), "order");
  });
}

for (const [text, want] of [
  ["paneer ka rate kya hai", "prices"],
  ["open bills", "open_bills"],
  ["add 2 samosa", "add_item"],
  ["remove naan", "remove_item"],
  ["Ravi paid 500", "payment"],
  ["#1042 paid", "payment"],
  ["show bill", "show_bill"],
  ["actually paneer was 3", "correction"],
  ["rename panner to paneer", "rename"],
  ["hi", "greeting"],
] as const) {
  test(`still ${want}: ${JSON.stringify(text)}`, () => {
    assert.equal(name(text), want);
  });
}

for (const [text, who] of [
  ["this is Ravi", "Ravi"],
  ["customer Meera", "Meera"],
  ["its Ravi Jerath", "Ravi Jerath"],
  ["that's Meera", "Meera"],
  ["naam Meera", "Meera"],
  ["Ravi Jerath ka bill hai", "Ravi Jerath"],
] as const) {
  test(`names a bill: ${JSON.stringify(text)}`, () => {
    const intent = classifyIntent(text);
    assert.equal(intent.name, "set_customer");
    assert.equal(intent.customer, who);
  });
}
