// What Likho can be told, and how one message is split into instructions.
//
// THE RULE: one message = a sequence of commands, run top to bottom.
// A command starts at the beginning of a line, or mid-line after
// whitespace; everything up to the next command is its arguments.
//
// Splitting deterministically here is what stops the model ever having to
// guess whether "/add mithai 10" was an instruction or part of an order —
// a question it got wrong repeatedly.

export const HELP = `Likho \u2014 send me the order, I'll make the bill.

Just type it. No commands needed:
  Ravi 2 paneer 1 lassi

Or forward the customer's message straight to me.

Set your rates first, one per line:
  /add paneer 220
  lassi 80
  samosa 20

Then talk to me normally:
  actually paneer was 3    fix the open bill
  add 2 samosa             add to it
  remove lassi             take it off
  show #1042               see any bill
  #1042 paid               record payment
  sales                    today's total
  yesterday sales          any day, week or month

Your bill's look:
  bill format              see all 6 styles, pick one
  shop phone 98200 41122   your details on the bill
  shop gstin 27AAB...      add GST, UPI, address

When a name could mean two things I ask once and remember your answer:
  what have you learned    see what you've taught me
  forget paner             undo one

Buttons on each bill do the same thing.

  setup                    redo your shop setup`;

// Saves prices in whatever shape the seller typed them - see priceList.ts.
// Partial success is deliberate: an unreadable fragment must never discard
// the items that WERE understood.
//
// Each entry is one of three things, and they are NOT the same:
//   new           - save it
//   same price    - nothing to do, say so
//   price change  - ASK. Changing a saved price changes what every future
//                   bill charges, and it happened silently before: typing
//                   "/add paneer 100" when paneer was 200 quietly halved
//                   the price with a reply that read like a fresh save.

export const GREETING_REPLY =
  "Hi! Send me an order and I'll make the bill.\n\n" +
  "  Ravi 2 paneer 1 lassi\n\n" +
  "You can also forward a customer's message straight to me.";

// Every command Likho understands. Commands are now OPTIONAL shortcuts —
// normal typing is handled by the intent layer — but they stay supported
// because a seller who learned them shouldn't be broken.
export const KNOWN_COMMANDS = [
  "/start", "/help", "/add", "/prices", "/list", "/items", "/menu", "/rates", "/remove",
  "/zbill", "/plus", "/additem", "/minus", "/removeitem",
  "/bill", "/done", "/sales", "/paid", "/open", "/rename", "/learned", "/forget",
  "/format", "/style", "/shop", "/pdf", "/setup", "/mock",
];

export interface ParsedCommand {
  command: string;
  args: string;
}

// THE RULE: one message = a sequence of commands, run top to bottom.
//
// A command starts at the beginning of a line, or mid-line after
// whitespace. Everything up to the next command is its arguments:
//
//   /add samosa 20\nchai 15         -> one /add, two lines of arguments
//   /zbill 2 chai\n/plus 1 mithai   -> two commands
//   /zbill 2 chai /plus 1 mithai    -> two commands (same line)
//
// Splitting deterministically here means the model never has to guess
// whether "/add mithai 10" was an instruction or part of an order.
export function splitCommands(text: string): ParsedCommand[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const hits: { index: number; command: string }[] = [];
  for (const cmd of KNOWN_COMMANDS) {
    const pattern = new RegExp(`(^|\\s)(${cmd})(?=\\s|$)`, "gi");
    for (const m of trimmed.matchAll(pattern)) {
      hits.push({ index: m.index! + m[1]!.length, command: cmd });
    }
  }

  if (hits.length === 0) return [{ command: "", args: trimmed }];

  hits.sort((a, b) => a.index - b.index);

  // Text BEFORE the first command belongs to that command. It used to be
  // discarded, which silently dropped the customer from
  // "ria bhanushali /zbill 3 mudpie" — the bill came out with no name and
  // nothing indicated why. People put the command where it falls in the
  // sentence; the parser has to read the whole sentence.
  const prefix = trimmed.slice(0, hits[0]!.index).trim();

  const parsed: ParsedCommand[] = [];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    const argsStart = hit.index + hit.command.length;
    const argsEnd = i + 1 < hits.length ? hits[i + 1]!.index : trimmed.length;
    const args = trimmed.slice(argsStart, argsEnd).trim();
    parsed.push({
      command: hit.command.toLowerCase(),
      args: i === 0 && prefix.length > 0 ? `${prefix} ${args}`.trim() : args,
    });
  }
  return parsed;
}
