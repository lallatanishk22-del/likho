import { test } from "node:test";
import assert from "node:assert/strict";
import { splitCommands, KNOWN_COMMANDS } from "../src/commands.js";

const one = (t: string) => splitCommands(t)[0]!;

// --- THE REPORTED BUG ---------------------------------------------------
//
// A seller typed "/Addbiryani 220\nraita 30 each". The space after the
// command was lost — which phone keyboards do constantly — so nothing
// matched, the message fell through to the ORDER parser, the model read
// "Addbiryani" as a dish, and the reply told them to add it by typing
// "/add biryani 100": the exact thing they had just typed.
//
// A "/" is not business data. It is the one character a seller types to
// say "this is an instruction".

test("a command glued to its first argument still runs", () => {
  const [cmd] = splitCommands("/Addbiryani 220\nraita 30 each");
  assert.equal(cmd!.command, "/add");
  assert.equal(cmd!.args, "biryani 220\nraita 30 each");
});

test("the glued form keeps its LINES, because the price list reads lines", () => {
  // Flattening this into one line would have made it a single product
  // called "biryani 220 raita" at ₹30.
  assert.equal(one("/Addbiryani 220\nraita 30 each").args.split("\n").length, 2);
});

test("the spaced form is unchanged", () => {
  assert.deepEqual(splitCommands("/add biryani 220"), [{ command: "/add", args: "biryani 220" }]);
});

test("case never matters", () => {
  for (const t of ["/ADDbiryani 220", "/Add biryani 220", "/aDdBiryani 220"]) {
    assert.equal(one(t).command, "/add", t);
  }
});

// --- The glue must not eat a longer command -----------------------------

test("the LONGEST matching command wins", () => {
  assert.equal(one("/additem 2 chai").command, "/additem");
  assert.equal(one("/removeitem lassi").command, "/removeitem");
  // ...and the short ones still resolve to themselves.
  assert.equal(one("/add chai 15").command, "/add");
  assert.equal(one("/remove chai").command, "/remove");
});

test("every known command resolves to itself, glued and spaced", () => {
  for (const cmd of KNOWN_COMMANDS) {
    assert.equal(one(cmd).command, cmd, `${cmd} bare`);
    assert.equal(one(`${cmd} x`).command, cmd, `${cmd} spaced`);
  }
});

// --- An unknown command is a typo, not an order -------------------------
//
// This is the whole reason the bug cost a bill: an unresolved "/word" was
// handed to the order parser, which will always find SOMETHING to bill.

test("a message starting with an unknown command is not billed", () => {
  const [cmd] = splitCommands("/addd biryani 220");
  assert.equal(cmd!.command, "/addd", "an unknown command must surface as a command");
  assert.notEqual(cmd!.command, "", "it must never fall through to the order parser");
});

test("a stray slash inside a sentence does not refuse the order", () => {
  // Punctuation mid-sentence is not a seller reaching for a command, and
  // refusing a real order over it would be the worse failure.
  assert.equal(one("ravi 2 paneer /naan 1").command, "");
  assert.equal(one("ravi 2 paneer /naan 1").args, "ravi 2 paneer /naan 1");
});

test("a slash followed by a digit is a quantity, never a command", () => {
  for (const t of ["1/2 kg paneer", "2 chai /3 samosa", "12/09 sales"]) {
    assert.equal(one(t).command, "", t);
  }
});

// --- Everything that already worked, still works ------------------------

test("several commands in one message still split in order", () => {
  assert.deepEqual(splitCommands("/zbill 2 chai\n/plus 1 mithai"), [
    { command: "/zbill", args: "2 chai" },
    { command: "/plus", args: "1 mithai" },
  ]);
});

test("text before the first command is still kept", () => {
  assert.deepEqual(splitCommands("ria bhanushali /zbill 3 mudpie"), [
    { command: "/zbill", args: "ria bhanushali 3 mudpie" },
  ]);
});

test("plain language is still plain language", () => {
  for (const t of ["ravi 2 paneer 1 chai", "who hasn't paid", "sales", "2 chai 3 samosa"]) {
    assert.equal(one(t).command, "", t);
    assert.equal(one(t).args, t);
  }
});

test("an empty message yields nothing", () => {
  assert.deepEqual(splitCommands("   "), []);
});

// --- A typo is a typo, a glue is a glue ---------------------------------
//
// "/addd biryani" and "/addbiryani 220" both fail an exact match, and the
// difference between them is not a list of spellings — it is distance.
// "addd" is one slip from "add"; "addbiryani" is seven.

test("a near-miss command is a typo, not a command with a weird argument", () => {
  for (const [typed, meant] of [["/addd", "/add"], ["/sale", "/sales"], ["/hlep", "/help"]] as [string, string][]) {
    const cmd = one(`${typed} biryani 220`);
    assert.notEqual(cmd.command, meant, `${typed} was silently run as ${meant}`);
    assert.notEqual(cmd.command, "", `${typed} fell through to the order parser`);
  }
});

test("a far-off remainder is a real argument", () => {
  assert.equal(one("/addbiryani 220").command, "/add");
  assert.equal(one("/pricesnow").command, "/prices");
});
