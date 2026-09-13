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
