import type { BillNote, NoteCategory } from "./types.js";

// What the seller told you that is NOT money.
//
//   pooja
//   3 thali 150
//   less spicy          <- this
//   home delivery 50
//   deliver by 8pm      <- and this
//
// "less spicy" was thrown away. It reached the model as part of the order,
// produced no item, and vanished. The seller then has to remember it
// themselves and tell the kitchen by hand — which is the exact work Likho
// exists to remove, and the kind of thing a customer complains about when
// it is missed.
//
// A bill is the record of a transaction, and "no onion, deliver by 8" IS
// part of that transaction. It belongs on the document.
//
// TWO DIFFERENT JOBS, AND ONLY ONE OF THEM IS ALLOWED TO FAIL:
//
//   CAPTURE is structural. A line that names no product and states no
//   money is an instruction. That rule has no vocabulary in it, so it
//   holds for Hindi, Marathi, or a sentence nobody has thought of.
//
//   CATEGORY is cosmetic. It decides which heading the line sits under.
//   If the keywords miss, the text still appears — under "Note" — so a
//   wrong category loses nothing. This is why a word list is acceptable
//   here and was not acceptable for deciding what a product is.

// Roughly ordered by how specific the signal is. First match wins, so
// "fast delivery" is read as TIMING (it is about speed) rather than as a
// delivery address.
// A MODIFIER TELLS YOU HOW MUCH; THE NOUN TELLS YOU WHAT KIND.
//
// "extra spoons" is packing and "extra spicy" is prep — the word they
// share decides nothing. So the concrete nouns are matched first, and
// prep, which owns the broad modifiers (less, extra, bina, kam), is the
// last resort. First match wins, and "fast delivery" is TIMING rather
// than a delivery address because speed is the specific thing being said.
const CATEGORY_WORDS: { category: NoteCategory; pattern: RegExp }[] = [
  {
    // When, and how fast. A clock time in any shape people type it, plus
    // the words for urgency.
    category: "timing",
    pattern:
      /\b(\d{1,2}[:.]?\d{0,2}\s*(am|pm|baje|bje|o'?clock)|fast|quick|urgent|asap|immediately|jaldi|turant|sharp|by\s+\d|before\s+\d|after\s+\d|tonight|today|tomorrow|kal|aaj|morning|afternoon|evening|night|subah|dopahar|shaam|raat|lunch|dinner|breakfast)\b/i,
  },
  {
    // Concrete objects, so this beats the modifiers below.
    category: "packing",
    pattern:
      /\b(pack|packing|packed|parcel|separate|separately|alag|container|dabba|box|bag|spoon|spoons|fork|forks|cutlery|plate|plates|tissue|napkin|carry|takeaway|take\s*away)\b/i,
  },
  {
    // Where it goes.
    category: "delivery",
    pattern:
      /\b(deliver|delivery|address|home|office|pickup|pick\s*up|flat|building|society|apartment|tower|wing|gate|door|floor|lane|road|street|nagar|colony|sector|block|pin\s*code|landmark)\b/i,
  },
  {
    // How it should be cooked. The single most expensive thing to lose —
    // an allergy or a religious restriction lives here.
    category: "prep",
    pattern:
      /\b(spicy|spice|mirchi|mirch|teekha|tikha|chilli|masala|onion|pyaaz|pyaz|garlic|lehsun|lasun|jain|vegan|ginger|adrak|oil|tel|butter|ghee|sugar|salt|namak|meetha|mitha|sweet|garam|thanda|fresh|well\s*done|raw|kacha|without|bina|less|kam|extra|zyada|no\s+\w+|allergy|allergic)\b/i,
  },
];

export const CATEGORY_LABEL: Record<NoteCategory, string> = {
  prep: "Prep",
  timing: "Timing",
  packing: "Packing",
  delivery: "Delivery",
  note: "Note",
};

// Words a seller uses to address LIKHO, not to describe the food.
//
// The one closed list here, and it is deliberately strict: a line is only
// dropped when EVERY word in it is chatter. "total batao" goes; "less
// spicy" stays, because "less" is not in the set. A line that is half
// instruction is kept whole — losing an instruction is far worse than
// printing a stray "please".
const CHATTER = new Set([
  "total", "batao", "bata", "bta", "batado", "do", "de", "dena", "dedo",
  "bhejo", "bhej", "bhejna", "bhejdo", "banao", "bana", "banado", "banado",
  "kitna", "kitne", "hua", "hue", "hogaya", "ho", "gaya", "bill", "order",
  "ok", "okay", "k", "thik", "theek", "hai", "haan", "ha", "yes", "ji",
  "thanks", "thank", "thx", "please", "pls", "plz", "bhaiya", "bhai", "sir",
  "madam", "ma'am", "and", "aur", "or", "the", "a", "an", "for", "to",
]);

function isChatter(line: string): boolean {
  const words = line.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  return words.every((w) => CHATTER.has(w));
}

// A clock time is not a quantity and not a price. "deliver by 8pm" and
// "7 baje tak" must still read as instructions rather than as money.
const TIME_SHAPED = /\b\d{1,2}([:.]\d{2})?\s*(am|pm|baje|bje|o'?clock)\b|\b(by|before|after|tak|se)\s+\d{1,2}\b/i;

// Decides whether one line is an instruction, and which heading it belongs
// under. Returns null when the line is money, a product, or chatter.
//
// `namesAProduct` is supplied by the caller so this file never touches the
// database — the same shape as the numeral expander and the charge parser.
export function classifyNote(
  line: string,
  namesAProduct: (phrase: string) => boolean,
): BillNote | null {
  const text = line.trim().replace(/\s{2,}/g, " ");
  if (text.length < 2) return null;

  // An explicit marker overrides everything: if the seller wrote "note:",
  // they have already told us what this line is.
  const marked = text.match(/^(?:note|instruction|instructions|special|remark|remarks|msg|message)\s*[:\-]\s*(.+)$/i);
  if (marked) return { category: "note", text: marked[1]!.trim() };

  // MONEY IS NOT A NOTE. A line carrying a number that is not a clock time
  // is an item, a charge or a price, and belongs to the parsers that
  // handle those. Losing an item into the notes column would be far worse
  // than losing a note.
  const stripped = text.replace(TIME_SHAPED, " ");
  if (/\d/.test(stripped)) return null;

  if (namesAProduct(text.toLowerCase())) return null;
  if (isChatter(text)) return null;

  for (const { category, pattern } of CATEGORY_WORDS) {
    if (pattern.test(text)) return { category, text };
  }

  // AN UNRECOGNISED LINE IS NOT A NOTE. It goes on to the extractor,
  // exactly as before.
  //
  // The first version captured anything left over, which read "pooja" —
  // the customer — as a note and produced an anonymous bill. A bill with
  // no name is a hole in the business's memory: it can never be looked up,
  // chased, or counted toward what someone owes. "ria bhanushali" would
  // have gone the same way.
  //
  // So capture is deliberately NOT the full remainder. A line becomes a
  // note when it says what KIND of instruction it is — by matching a
  // category above, or by the seller marking it "note: ...". Losing an
  // unlabelled remark is a small cost; losing the customer is not.
  return null;
}

// Notes in the order they were written, with exact duplicates collapsed.
// Grouping by category happens at render time, not here — the bill decides
// how to show them, this decides what they are.
export function dedupeNotes(notes: BillNote[]): BillNote[] {
  const seen = new Set<string>();
  const out: BillNote[] = [];
  for (const n of notes) {
    const key = `${n.category}|${n.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}
