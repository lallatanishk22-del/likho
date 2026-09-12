// Reading a discount out of the seller's message, in code.
//
// The local model could not cope with one. Every shape failed differently:
//
//   "dhruv 2 cakes"                     -> billed fine
//   "dhruv 2 cakes 20 percent discount" -> "No price found for cakes"
//   "dhruv 2 cake 10 percent discount"  -> invalid JSON
//   "dhruv 2 chai 20 percent discount"  -> trust layer: "an item may be missing"
//
// The extra number pulled the extraction apart: it was read as a price, or
// counted as another item's quantity, or simply broke the output.
//
// But a discount is not messy human language — it is a number next to the
// word "percent", "%" or "off". That is a regex, and a regex is exact. So
// it is parsed here and REMOVED before the message reaches the model, the
// same way a date is removed before a customer-name lookup: take the part
// that is deterministic out of the model's way, and it stops confusing it.
//
// The percentage itself never touches money directly — calculator.ts
// applies it, clamped to [0, subtotal] as it always has.

export interface DiscountParse {
  percent: number | null;
  // The message with the discount phrase removed, for the extractor.
  rest: string;
}

// The PREFIX form is tried first ("discount 15%"), because the suffix
// pattern would otherwise match just the "15%" inside it and leave a
// stray "discount" in the order text for the model to trip over.
//
// Note there is no trailing \b on either: a word boundary after an
// OPTIONAL group fails when the string ends there, so "20%" — with
// nothing after it — matched nothing at all.
const PATTERNS: RegExp[] = [
  // "discount 15%", "discount of 15 percent", "off 20%"
  /\b(?:discount|off|chhut|chut)\s*(?:of\s+)?(\d{1,3}(?:\.\d+)?)\s*(?:%|percent|pct|per\s*cent)?/i,
  // "20% off", "20 percent discount", "flat 30% off", "12.5%"
  /\b(?:flat\s+)?(\d{1,3}(?:\.\d+)?)\s*(?:%|percent|pct|per\s*cent)\s*(?:ka\s+)?(?:discount|off|chhut|chut)?/i,
];

export function parseDiscount(text: string): DiscountParse {
  for (const pattern of PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;

    const value = Number(match[1]);
    // A "discount" over 100% is a typo, not an instruction. Leaving it to
    // the calculator would clamp it silently; refusing to read it at all
    // keeps the number visible in the message where the seller can see it.
    if (!Number.isFinite(value) || value <= 0 || value > 100) continue;

    return {
      percent: value,
      rest: text.replace(pattern, " ").replace(/\s+/g, " ").trim(),
    };
  }
  return { percent: null, rest: text };
}
