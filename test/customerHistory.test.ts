import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent } from "../src/intent.js";
import { splitCommands } from "../src/messageHandler.js";

const name = (t: string) => classifyIntent(t).name;
const who = (t: string) => classifyIntent(t).text;

// --- RULE 1: a command always runs --------------------------------------
// Setup used to sit above command routing and swallow everything: "/prices"
// was saved as a product called "/prices", and "2 paneer 3 samosa" — an
// ORDER — became two price-list rows. A seller could not even reach /help
// to escape it.

test("a slash command is recognised as a command, whatever mode we are in", () => {
  for (const cmd of ["/help", "/prices", "/mock", "/format", "/add paneer 100", "/sales"]) {
    const parsed = splitCommands(cmd);
    assert.ok(parsed[0]!.command.startsWith("/"), `${cmd} was not seen as a command`);
  }
});

test("a command is never mistaken for a product line", () => {
  // "/prices" reaching a price parser is how it got saved as an item.
  const parsed = splitCommands("/prices");
  assert.equal(parsed[0]!.command, "/prices");
  assert.equal(parsed[0]!.args, "");
});

// --- RULE 2: a bare name is a QUESTION, never an instruction ------------

test("a name with items is an order", () => {
  assert.equal(name("ravi 2 chai"), "order");
  assert.equal(name("ravi bhanushali 3 paneer 2 lassi"), "order");
});

test("'ravi's bills' asks for history", () => {
  assert.equal(name("ravi's bills"), "customer_history");
  assert.equal(who("ravi's bills"), "ravi");
});

test("'ravi bills' asks for history", () => {
  assert.equal(name("ravi bills"), "customer_history");
  assert.equal(who("ravi bills"), "ravi");
});

test("'show ravi's bills' asks for history", () => {
  assert.equal(name("show ravi's bills"), "customer_history");
  assert.equal(who("show ravi's bills"), "ravi");
});

test("a full name survives", () => {
  assert.equal(who("ravi bhanushali's bills"), "ravi bhanushali");
});

test("'history of ravi' works", () => {
  assert.equal(name("history of ravi"), "customer_history");
  assert.equal(who("history of ravi"), "ravi");
});

test("'ravi khata' works", () => {
  assert.equal(name("ravi khata"), "customer_history");
});

test("'how much does ravi owe' asks for history", () => {
  assert.equal(name("how much does ravi owe"), "customer_history");
  assert.equal(who("how much does ravi owe"), "ravi");
});

test("'ravi owes me?' asks for history", () => {
  assert.equal(name("ravi owes me?"), "customer_history");
});

// --- The collisions a greedy history pattern caused --------------------
// Each of these was broken by an earlier version of the rule above.

test("'open bills' still lists unconfirmed bills, not a customer called 'open'", () => {
  assert.equal(name("open bills"), "open_bills");
});

test("'pending bills' still lists unconfirmed bills", () => {
  assert.equal(name("pending bills"), "open_bills");
});

test("'show bill' still shows the current bill", () => {
  assert.equal(name("show bill"), "show_bill");
});

test("'show #1042' still opens that bill", () => {
  assert.equal(name("show #1042"), "show_bill");
});

test("stop-words are never read as customer names", () => {
  for (const phrase of ["my bills", "all bills", "today's bills", "latest bills", "draft bills"]) {
    assert.notEqual(who(phrase), phrase.split(" ")[0], `"${phrase}" captured a stop-word as a name`);
  }
});

test("a phrase with digits is never a history lookup", () => {
  // "2 paneer bills" is nonsense as a lookup and dangerous as one.
  assert.notEqual(name("2 chai bills"), "customer_history");
});

test("an overlong phrase is not treated as a name", () => {
  assert.notEqual(name("something long that is clearly not a person bills"), "customer_history");
});

// --- Who owes money -----------------------------------------------------

test("'who hasn't paid' lists everyone outstanding", () => {
  assert.equal(name("who hasn't paid"), "outstanding");
  assert.equal(name("who has not paid"), "outstanding");
});

test("the Hinglish words for credit work", () => {
  assert.equal(name("udhaar"), "outstanding");
  assert.equal(name("baaki"), "outstanding");
});

test("'unpaid' lists everyone outstanding", () => {
  assert.equal(name("unpaid"), "outstanding");
});

// --- Orders are never stolen -------------------------------------------

test("ordinary orders still route to order", () => {
  for (const order of [
    "ravi 2 paneer 1 lassi",
    "2 chai 3 samosa",
    "ravi ka bill bana 2 paneer",
    "3 paner , 1 chai , rot i",
  ]) {
    assert.equal(name(order), "order", order);
  }
});
