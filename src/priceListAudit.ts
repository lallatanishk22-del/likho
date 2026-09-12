import { suggestSpelling, findNearDuplicate } from "./spellingSuggest.js";

// Checking the price list a seller ALREADY has.
//
// Every one of these checks existed, but only ran at /add time. A list
// built up over weeks — through typos, a bad parse, and the same item
// entered twice — was never looked at again, so the problems just sat
// there and printed onto customers' bills.
//
// Nothing here changes anything. It reports, and the seller taps.

export type PriceProblem =
  | { kind: "bad_name"; name: string; price: number; suggested: string }
  | { kind: "misspelling"; name: string; price: number; suggested: string }
  | { kind: "duplicate"; name: string; price: number; other: string; otherPrice: number };

export interface PriceProduct {
  name: string;
  price: number;
}

// A product name that begins with a number is a parse failure, not a name:
// "10 chutney" at Rs 3 is "chutney 10" read backwards. It would print on a
// bill as "10 Chutney x 2", which is nonsense to a customer.
function strippedName(name: string): string | null {
  const stripped = name.replace(/^\s*\d+\s*/, "").trim();
  return stripped.length > 0 && stripped !== name ? stripped : null;
}

export function auditPriceList(products: PriceProduct[]): PriceProblem[] {
  const problems: PriceProblem[] = [];
  const pairedUp = new Set<string>();

  for (const product of products) {
    const fixed = strippedName(product.name);
    if (fixed) {
      problems.push({ kind: "bad_name", name: product.name, price: product.price, suggested: fixed });
      continue;
    }

    // A duplicate matters more than a misspelling: two entries for one item
    // split the seller's sales and make a typo'd order unpriceable.
    const duplicate = findNearDuplicate(product.name, products);
    if (duplicate) {
      // Report each pair once, not once from each side.
      const key = [product.name, duplicate.existing].sort().join("\u0000");
      if (!pairedUp.has(key)) {
        pairedUp.add(key);
        problems.push({
          kind: "duplicate",
          name: product.name,
          price: product.price,
          other: duplicate.existing,
          otherPrice: duplicate.existingPrice,
        });
      }
      continue;
    }

    const spelling = suggestSpelling(product.name);
    if (spelling) {
      problems.push({
        kind: "misspelling",
        name: product.name,
        price: product.price,
        suggested: spelling.suggested,
      });
    }
  }

  return problems;
}
