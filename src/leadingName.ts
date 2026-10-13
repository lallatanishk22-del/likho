import { stripDateExpressions } from "./businessDay.js";

// The name at the front of an order, when the model misses it.
//
// "ravi 2 thali 150 1 dal 90"  -> Ravi
// "sana 2 thali 150 1 dal 90"  -> nothing
//
// Same sentence, same position, and the model found one name and not the
// other. It has no way to know "sana" is a person; it is guessing from how
// familiar the word looks. That is not a basis for a business record.
//
// An anonymous bill is a hole in the business's memory — it can never be
// looked up by name, chased for payment, or counted toward what someone
// owes — and the seller is asked "who is this for?" on every single bill
// whose customer happens to have an uncommon name.
//
// Position is deterministic where familiarity is not: in an order, the
// words BEFORE the first quantity are the customer. Everything that is not
// a name is removed by rules that already exist — dates by
// stripDateExpressions, products by the seller's own price list — and what
// survives is a name or nothing.
//
// USED ONLY AS A FALLBACK, when the model returned no customer at all. It
// can never overrule an extraction, so it can only add.

// Words that sit around a name without being one. Deliberately small: it
// holds ordering particles and forms of address, not a general filler list
// — the heavy lifting is done by position and by the price list.
const NOT_A_NAME = new Set([
  "for", "to", "ke", "ki", "ka", "ko", "liye", "waste", "ne", "se", "me", "mein",
  "bill", "order", "banao", "bana", "bhej", "bhejo", "please", "pls", "plz",
  "bhaiya", "bhai", "sir", "madam", "maam", "ji", "arey", "yaar", "hey", "hi",
  "and", "aur", "plus", "the", "a", "an", "this", "is", "of", "add", "new",
  "customer", "cust", "name", "party", "table", "room",
]);

export function leadingCustomerName(
  orderText: string,
  namesAProduct: (phrase: string) => boolean,
): string | null {
  const firstLine = orderText.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  if (!firstLine) return null;

  // A date is not a customer. "aaj ke liye 2 thali" must not bill Aaj.
  const withoutDates = stripDateExpressions(firstLine);

  const tokens = withoutDates.split(/\s+/).filter((t) => t.length > 0);
  const before: string[] = [];
  for (const token of tokens) {
    if (/\d/.test(token)) break;
    before.push(token);
  }
  // THE NAME ENDS WHERE THE FIRST PRODUCT BEGINS. "Tanishk chai 1 samosa 2"
  // puts the item before its quantity, so "everything before the first
  // number" was "Tanishk chai" — which contains a product, so the whole
  // thing was rejected and the typed name was lost. Cut at the first word
  // that starts a product instead (checked alone and as a phrase, so "rose
  // milk" still counts as one product). A product in first place still
  // means no customer was named.
  const clean = (w: string) => w.replace(/[^\p{L}'’-]/gu, "").toLowerCase();
  const phrase = (from: number, to: number) => before.slice(from, to).map(clean).join(" ");
  // A word starts a product only if it is PART of it: the real matcher also
  // accepts a phrase that merely CONTAINS a product, so "tanishk chai"
  // matched because of "chai". Requiring the phrase to stop matching once
  // its first word is dropped keeps "rose milk" a product and "tanishk" a name.
  const startsProductAt = (i: number): boolean => {
    if (namesAProduct(clean(before[i]!))) return true;
    for (let j = i + 2; j <= before.length; j++) {
      if (namesAProduct(phrase(i, j)) && !namesAProduct(phrase(i + 1, j))) return true;
    }
    return false;
  };
  for (let i = 0; i < before.length; i++) {
    if (startsProductAt(i)) {
      before.length = i;
      break;
    }
  }
  if (before.length === 0) return null;

  // A NAME SITS DIRECTLY BEFORE THE ORDER. "can you please make me 2
  // thali" has five words in front of the quantity; that is a sentence,
  // and stripping particles out of a sentence leaves a different sentence,
  // not a name. Position again, rather than a list of English verbs.
  if (before.length > 3) return null;

  const words = before
    .map((w) => w.replace(/[^\p{L}'’-]/gu, ""))
    .filter((w) => w.length > 0 && !NOT_A_NAME.has(w.toLowerCase()));

  // Nothing left, or a whole sentence rather than a name.
  if (words.length === 0 || words.length > 2) return null;

  // THE PRICE LIST HAS THE LAST WORD. An order that opens with a product
  // ("paneer tikka 2") names no customer, and a seller whose customer is
  // called Rose must not have "rose" read as a name when they sell Rose
  // Milk — that is a genuine ambiguity, and silence is the safe answer.
  if (namesAProduct(words.join(" ").toLowerCase())) return null;
  for (const w of words) {
    if (namesAProduct(w.toLowerCase())) return null;
  }

  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// The name at the END of an order, when the model misses it and nothing
// came first: "cake 2 fenil" lost "fenil" completely — the model returned
// no customer, the front-of-message rule found none, and the word simply
// vanished from a bill that looked complete.
//
// The words after the last quantity are the candidate. Any product of the
// seller's at their start is the order's last item, not the name, and is
// skipped ("3 mudpie ria bhanushali" -> Ria Bhanushali). What survives
// must be one or two plain words that name no product and are not a known
// order word.
//
// A word at the end can also be an instruction ("2 chai garam"), so this
// is less certain than a name at the front. The caller says on the bill
// where the name came from, so a wrong guess is seen and fixed in one
// message — never silently kept.
const NOT_A_TRAILING_NAME = new Set([
  ...NOT_A_NAME,
  "each", "only", "rs", "rupees", "rupaye", "rupee", "inr", "extra", "garam", "thanda",
  "spicy", "less", "more", "kam", "zyada", "jaldi", "urgent", "fast", "quick", "discount",
  "off", "delivery", "packing", "parcel", "takeaway", "chahiye", "dena", "de", "do",
  "dedo", "kar", "karo", "kardo", "plate", "plates", "glass", "glasses", "cup", "cups",
  "kg", "kgs", "gm", "gms", "gram", "grams", "litre", "liter", "ltr", "ml", "piece",
  "pieces", "pcs", "pc", "half", "full", "dabba", "box", "today", "aaj", "kal",
  "tomorrow", "total", "thanks", "thank", "you", "ok", "okay", "done", "paid", "cash",
  "upi", "online", "pending", "baaki", "udhaar", "udhar", "fresh", "hot", "cold",
  "small", "medium", "large", "big", "jain", "veg", "nonveg",
]);

export function trailingCustomerName(
  orderText: string,
  namesAProduct: (phrase: string) => boolean,
  // Exact product match (no "contains a product" leniency): finds where the
  // last item ENDS. With containment, "mudpie ria bhanushali" counted as one
  // product because it contains "mudpie", and the name was swallowed.
  isExactProduct: (phrase: string) => boolean = namesAProduct,
): string | null {
  const lines = orderText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const lastLine = lines[lines.length - 1];
  if (!lastLine) return null;
  const tokens = stripDateExpressions(lastLine).split(/\s+/).filter((t) => t.length > 0);
  const lastNumber = tokens.reduce((at, t, i) => (/\d/.test(t) ? i : at), -1);
  if (lastNumber < 0) {
    // A one-line message with no quantity isn't an order end at all.
    if (lines.length === 1) return null;
    // "2 chai\n3 samosa\nRahul": a last line of plain words after an order.
    return asName(tokens.map((w) => w.replace(/[^\p{L}'’-]/gu, "")), namesAProduct);
  }
  const after = tokens.slice(lastNumber + 1).map((w) => w.replace(/[^\p{L}'’-]/gu, ""));
  // Skip the order's last item if it sits after its quantity ("2 chai rahul").
  const lower = after.map((w) => w.toLowerCase());
  let start = 0;
  for (let j = lower.length; j > 0; j--) {
    if (isExactProduct(lower.slice(0, j).join(" "))) {
      start = j;
      break;
    }
  }
  return asName(after.slice(start), namesAProduct);
}

function asName(words: string[], namesAProduct: (phrase: string) => boolean): string | null {
  const kept = words.filter((w) => w.length > 0 && !NOT_A_TRAILING_NAME.has(w.toLowerCase()));
  if (kept.length === 0 || kept.length > 2) return null;
  // Everything left must be ONLY name: an unknown word sitting between
  // known ones ("2 chai garam rahul" minus "garam") is fine, but anything
  // that is or contains a product is not a person.
  if (kept.some((w) => w.length < 2 || namesAProduct(w.toLowerCase()))) return null;
  if (namesAProduct(kept.join(" ").toLowerCase())) return null;
  return kept.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
