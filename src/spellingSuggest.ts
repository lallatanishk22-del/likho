// Catching a misspelling in the seller's OWN price list.
//
// This is a different problem from near-matching an order against the
// catalog (catalog.ts). That one fixes a typo the seller makes WHILE
// billing, and never changes stored data. This one is about a typo that
// got saved: "panner" instead of "paneer". Once it is in the price list it
// is permanent, and it prints on every bill the customer ever sees.
//
// The rule is the same as everywhere else here: software proposes, the
// seller decides. This NEVER rewrites a name on its own. It is the seller's
// business and the seller's menu — a shop genuinely called "Panner Corner"
// is not a mistake, and being overruled by a spellchecker would be worse
// than the typo.

import { suggestFromList } from "./nearName.js";

// Common spellings for the segment Likho serves: tiffin services, small
// restaurants, snack and sweet shops. Deliberately not exhaustive — a
// suggestion only fires when one of these is a near-miss, so an unknown
// dish is simply left alone rather than "corrected" into something else.
export const CANONICAL_ITEMS: string[] = [
  // Paneer and North Indian mains
  "paneer", "paneer tikka", "paneer butter masala", "shahi paneer",
  "kadai paneer", "palak paneer", "matar paneer", "chilli paneer",
  "dal makhani", "dal fry", "dal tadka", "chana masala", "chole",
  "rajma", "aloo gobi", "malai kofta", "mix veg", "bhindi masala",
  "butter chicken", "chicken tikka", "chicken curry", "chicken biryani",
  "mutton biryani", "veg biryani", "egg curry", "fish curry",

  // Breads and rice
  "roti", "chapati", "tandoori roti", "naan", "butter naan", "garlic naan",
  "paratha", "aloo paratha", "paneer paratha", "gobi paratha", "lachha paratha",
  "puri", "bhatura", "kulcha", "rice", "jeera rice", "pulao", "fried rice",

  // South Indian
  "dosa", "masala dosa", "plain dosa", "rava dosa", "onion dosa",
  "idli", "vada", "medu vada", "sambar", "uttapam", "upma", "poha",

  // Street food and snacks
  "samosa", "kachori", "pakora", "vada pav", "pav bhaji", "misal pav",
  "dabeli", "bhel puri", "sev puri", "pani puri", "dahi puri", "ragda pattice",
  "chaat", "aloo tikki", "spring roll", "momos", "frankie", "sandwich",
  "grilled sandwich", "burger", "pizza", "pasta", "maggi", "french fries",
  "manchurian", "noodles", "hakka noodles", "chowmein", "paneer roll",
  "egg roll", "chicken roll", "kathi roll", "omelette", "bread omelette",

  // Sweets
  "gulab jamun", "rasgulla", "rasmalai", "jalebi", "ladoo", "barfi",
  "kaju katli", "halwa", "gajar halwa", "kheer", "shrikhand", "basundi",
  "mudpie", "brownie", "pastry", "cake", "ice cream", "falooda",

  // Drinks
  "chai", "masala chai", "coffee", "cold coffee", "lassi", "sweet lassi",
  "mango lassi", "chaas", "buttermilk", "milkshake", "juice",
  "mosambi juice", "orange juice", "sugarcane juice", "lemon soda",
  "nimbu pani", "thums up", "coke", "pepsi", "sprite", "fanta",
  "mineral water", "soda",

  // Sides
  "raita", "boondi raita", "salad", "green salad", "papad", "curd",
  "dahi", "pickle", "chutney", "butter", "cheese", "extra gravy",
];

export interface SpellingSuggestion {
  typed: string;
  suggested: string;
}

// Returns a canonical spelling when the typed name is a near-miss of one,
// and null otherwise. Null is the common case and the safe one.
export function suggestSpelling(name: string): SpellingSuggestion | null {
  const suggested = suggestFromList(name, CANONICAL_ITEMS);
  if (suggested === null) return null;
  return { typed: name, suggested };
}


// --- Near-duplicates inside the seller's OWN price list ------------------
//
// Adding "paneer" when "panner" is already saved leaves two products that
// are the same thing. That is worse than untidy: catalog.ts refuses to
// resolve a name that is equally close to two products, so a later order
// for "paaner" becomes ambiguous and REFUSES TO BILL. The duplicate breaks
// the thing the price list exists for.
//
// Detected against the seller's own list, so it works for items no
// dictionary knows about ("zunka" vs "zunkaa").

export interface DuplicateWarning {
  added: string;
  existing: string;
  existingPrice: number;
}

export function findNearDuplicate(
  name: string,
  existing: { name: string; price: number }[],
): DuplicateWarning | null {
  const others = existing.filter((p) => p.name.toLowerCase() !== name.toLowerCase());
  const match = suggestFromList(name, others.map((p) => p.name));
  if (match === null) return null;
  const found = others.find((p) => p.name === match)!;
  return { added: name, existing: found.name, existingPrice: found.price };
}
