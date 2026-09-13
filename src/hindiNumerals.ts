// Quantities written as words, in the language the seller actually types.
//
// "do chai" is two teas. The model reads it as an item called "do chai",
// or asks "how many chai?" — and a seller who has just been asked how many
// when they plainly said "do" does not ask again, they leave.
//
// WHY THIS LIST IS ALLOWED TO EXIST, when the filler-word lists were not:
//
// A numeral system is CLOSED and finite. "ek, do, teen, char" is the whole
// of it and it will not grow. Filler is open-ended — every attempt to list
// it broke on the next word a real person typed ("dude", "yesterday",
// "total", "chahiye"), which is why products are matched against the
// seller's own catalog instead. Numerals are a fact about the language;
// filler is a guess about intent.
//
// Even so, this never fires on its own judgement. "do" is also an ordinary
// English verb, so a numeral is only read as a quantity when the thing
// AFTER it is something the seller genuinely sells. The catalog decides,
// exactly as it does for names.

const NUMERALS: Record<string, number> = {
  // Hindi/Urdu
  ek: 1, eak: 1, aik: 1,
  do: 2, dho: 2,
  teen: 3, tin: 3, theen: 3,
  char: 4, chaar: 4,
  paanch: 5, panch: 5, paach: 5, pach: 5,
  chhe: 6, che: 6, chah: 6, chhah: 6,
  saat: 7, sat: 7,
  aath: 8, ath: 8,
  nau: 9, nao: 9,
  das: 10, dus: 10,
  gyarah: 11, barah: 12, baarah: 12,
  // Marathi, which a Pune or Nashik seller will type instead
  don: 2, teenn: 3, chaar_mr: 4, paach_mr: 5,
  // Counting words used the same way
  dozen: 12, jodi: 2, joda: 2,
};

// How far past the numeral to look for something the seller sells.
// "do plate paneer tikka" needs three tokens; beyond that a match is more
// likely coincidence than grammar.
const LOOKAHEAD = 3;

export function isNumeralWord(word: string): boolean {
  return Object.prototype.hasOwnProperty.call(NUMERALS, word.toLowerCase());
}

// Rewrites numeral WORDS into digits, but only where the following tokens
// name a product. `isProduct` is supplied by the caller so this file never
// touches the database and stays a pure, testable function.
//
// Returns the text unchanged when nothing qualifies — silence is the
// correct answer for an English sentence containing "do".
export function expandHindiNumerals(
  text: string,
  isProduct: (phrase: string) => boolean,
): string {
  const tokens = text.split(/(\s+)/); // keep separators, so spacing survives
  const words = tokens.filter((_, i) => i % 2 === 0);

  let changed = false;
  for (let i = 0; i < words.length; i++) {
    const bare = words[i]!.replace(/[^a-zA-Z]/g, "").toLowerCase();
    if (!bare || !isNumeralWord(bare)) continue;

    // A digit immediately before or after means the quantity is already
    // written plainly; leave the word alone rather than doubling it.
    const prev = words[i - 1] ?? "";
    const next = words[i + 1] ?? "";
    if (/\d/.test(prev) || /\d/.test(next)) continue;

    // THE GUARD: something the seller sells must follow.
    let qualifies = false;
    for (let span = 1; span <= LOOKAHEAD && i + span < words.length; span++) {
      const phrase = words.slice(i + 1, i + 1 + span).join(" ").replace(/[^a-zA-Z ]/g, "").trim();
      if (phrase.length > 0 && isProduct(phrase)) { qualifies = true; break; }
    }
    if (!qualifies) continue;

    words[i] = words[i]!.replace(/[a-zA-Z]+/, String(NUMERALS[bare]!));
    changed = true;
  }

  if (!changed) return text;

  let w = 0;
  return tokens.map((t, i) => (i % 2 === 0 ? words[w++]! : t)).join("");
}

// Cheap pre-check so the common case — a message with no numeral word in
// it — costs one regex and never touches the price store.
export function hasNumeralWord(text: string): boolean {
  return text.split(/\s+/).some((t) => isNumeralWord(t.replace(/[^a-zA-Z]/g, "")));
}
