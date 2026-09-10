import { test } from "node:test";
import assert from "node:assert/strict";
import { splitCommands } from "../src/messageHandler.js";

// THE RULE: one message = a sequence of commands, run in order.
// These lock in the behaviour of every shape a seller actually types.

test("a single command with arguments", () => {
  assert.deepEqual(splitCommands("/zbill 2 chai"), [{ command: "/zbill", args: "2 chai" }]);
});

test("REGRESSION: /add with one item per line stays ONE command with multiline args", () => {
  // Previously the newlines collapsed and this became a single product
  // named "samosa 20 chai 15 paneer roll" priced ₹120.
  const parsed = splitCommands("/add samosa 20\nchai 15\npaneer roll 120");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.command, "/add");
  assert.equal(parsed[0]!.args, "samosa 20\nchai 15\npaneer roll 120");
});

test("REGRESSION: two commands on ONE line are split", () => {
  const parsed = splitCommands("/zbill 1 chai 2 paneer roll /add mithai 10");
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], { command: "/zbill", args: "1 chai 2 paneer roll" });
  assert.deepEqual(parsed[1], { command: "/add", args: "mithai 10" });
});

test("two commands on separate lines are split", () => {
  const parsed = splitCommands("/zbill 2 chai\n/plus 1 mithai");
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]!.command, "/zbill");
  assert.equal(parsed[1]!.command, "/plus");
  assert.equal(parsed[1]!.args, "1 mithai");
});

test("plain text with no command is returned as-is", () => {
  assert.deepEqual(splitCommands("2 paneer 3 samosa"), [{ command: "", args: "2 paneer 3 samosa" }]);
});

test("an empty message yields nothing", () => {
  assert.deepEqual(splitCommands("   "), []);
});

test("command matching is case-insensitive", () => {
  assert.equal(splitCommands("/ZBILL 2 chai")[0]!.command, "/zbill");
});

test("a command with no arguments has empty args", () => {
  assert.deepEqual(splitCommands("/bill"), [{ command: "/bill", args: "" }]);
});

test("three commands in one message all run", () => {
  const parsed = splitCommands("/add chai 15 /zbill 2 chai /bill");
  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed.map((p) => p.command), ["/add", "/zbill", "/bill"]);
});

test("a word merely containing a command name is NOT split", () => {
  // "/zbill" only counts at a whitespace boundary, so item names are safe.
  const parsed = splitCommands("/zbill 2 addon rolls");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.args, "2 addon rolls");
});

// --- Text before the command belongs to the command --------------------
// "ria bhanushali /zbill 3 mudpie" produced a bill with no customer: the
// prefix was discarded before the order ever reached the parser.

test("a customer name written before the command is kept", () => {
  const parsed = splitCommands("ria bhanushali /zbill 3 mudpie");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.command, "/zbill");
  assert.equal(parsed[0]!.args, "ria bhanushali 3 mudpie");
});

test("the prefix attaches to the FIRST command only", () => {
  const parsed = splitCommands("ravi /zbill 2 chai /plus 1 lassi");
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]!.args, "ravi 2 chai");
  assert.equal(parsed[1]!.args, "1 lassi");
});

test("a command with nothing before it is unchanged", () => {
  const parsed = splitCommands("/zbill 3 mudpie");
  assert.equal(parsed[0]!.args, "3 mudpie");
});

test("a prefix on a command that takes no arguments does no harm", () => {
  const parsed = splitCommands("thanks /sales");
  assert.equal(parsed[0]!.command, "/sales");
  assert.equal(parsed[0]!.args, "thanks");
});

test("a multi-line prefix is kept", () => {
  const parsed = splitCommands("ria bhanushali\n/zbill 3 mudpie");
  assert.equal(parsed[0]!.args, "ria bhanushali 3 mudpie");
});
