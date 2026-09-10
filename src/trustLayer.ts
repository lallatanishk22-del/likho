import type { ValidatedOrder, ParsedOrder } from "./structuredOrder.js";
import { normalize, toParsedOrder, QUANTITY_WORDS } from "./structuredOrder.js";

// Stage 2: the trust layer. Shape validation (structuredOrder.ts) already
// confirmed each item is individually well-formed and grounded. This layer
// checks RELATIONSHIPS across the whole order — the thing existence checks
// structurally cannot see. It inspects the original message and the proposed
// structure independently; it does not lean on the model's own evidence
// field as proof of anything beyond "this text exists somewhere."
//
// This is deliberately not a mathematically complete proof of correctness —
// it is a set of deterministic suspicion signals used to decide whether an
// interpretation is safe to accept, or should be escalated instead.
export interface TrustSignals {
  // Same numeric price assigned to 2+ items in this order.
  priceReusedAcrossItems: boolean;
  // Two or more items cite the exact same evidence text — the model wasn't
  // able to point to distinct supporting text per item.
  duplicateEvidenceAcrossItems: boolean;
  // Standalone numbers in the original message that no item's evidence
  // accounts for (approximate — see extractStandaloneNumbers).
  unexplainedNumbers: number[];
  // A linkage word ("each", "@", "per", "ka", "rs", "₹") appears anywhere in
  // the message — informational only, not a gate by itself (many valid
  // orders never use one, e.g. "2 chicken biryani 450 1 raita 80").
  linkageKeywordPresent: boolean;
  // Quantity mentions ("2 <product>", "ek <product>") found in the message
  // that no item in the output accounts for — evidence an item was silently
  // dropped. Value-repeated correctly (multiset, not set) so a second
  // mention of an already-used quantity value isn't hidden by the first.
  unaccountedQuantityMentions: number[];
}

export interface TrustResult {
  trusted: boolean;
  reasons: string[];
  signals: TrustSignals;
}

export class TrustRejectedError extends Error {
  signals: TrustSignals;
  interpretation: ValidatedOrder;
  constructor(message: string, signals: TrustSignals, interpretation: ValidatedOrder) {
    super(message);
    this.name = "TrustRejectedError";
    this.signals = signals;
    this.interpretation = interpretation;
  }
}

const LINKAGE_KEYWORDS = ["each", "@", " per ", "ka ", " rs", "₹"];

// --- Item-completeness check ---------------------------------------------
//
// Reuses the exact QUANTITY_WORDS list from structuredOrder.ts (Experiment
// #3) — no second word-list. A "candidate quantity mention" is a digit or
// quantity word positioned like "N <product>" (quantity immediately before
// a plausible product word), deliberately excluding fee/total/discount
// contexts. This is intentionally conservative: it will under-detect rather
// than risk flagging legitimate orders (see report for known limitations).

// Words that, immediately AFTER a number, mean the number is a price/fee/
// total reference, not a product quantity (e.g. "50 each", "60 ka").
const NON_ITEM_FOLLOWERS = new Set([
  "each", "rs", "rupees", "ka", "ki", "ke", "wali", "wale", "wala", "per",
  "only", "aur", "and", "kar", "karo", "de", "dena", "do", "bhi", "extra",
  "off", "total", "discount", "delivery", "tax", "gst", "charge", "charges",
  "service", "or", "plus", "minus", "approx", "around", "kal", "please",
  "pls", "chahiye", "hai", "hain", "liye", "bana", "banao", "bhai", "bhaiya",
  "sir", "bro", "dena",
]);

// Words that, immediately BEFORE a number, mean the number is a fee/total
// reference (e.g. "delivery 60", "discount 20"), not a product quantity.
const NON_ITEM_PRECEDERS = new Set([
  "total", "discount", "delivery", "off", "extra", "tax", "gst", "charge",
  "charges", "service", "minus", "plus", "rs", "rupees", "only", "approx",
  "around", "by", "at", "before", "after", "phone", "mobile", "number",
  "order", "bill", "invoice",
]);

const QUANTITY_WORD_VALUES = new Map<string, number>();
for (const [value, words] of Object.entries(QUANTITY_WORDS)) {
  for (const word of words) QUANTITY_WORD_VALUES.set(word.toLowerCase(), Number(value));
}

// Plausible quantity range for this domain (small food orders). Deliberately
// narrow: prices are almost always outside this range or excluded by the
// follower/preceder checks anyway, and keeping it narrow biases toward
// missing a rare bulk-quantity omission rather than flagging a price as one.
const MIN_CANDIDATE_QUANTITY = 1;
const MAX_CANDIDATE_QUANTITY = 20;

function tokenAt(text: string, index: number, direction: "next" | "prev"): string | null {
  if (direction === "next") {
    const rest = text.slice(index);
    const match = rest.match(/^[\s,+\-—.]*([%]|\d+|[a-zA-Z]+)/);
    return match ? match[1]!.toLowerCase() : null;
  }
  const before = text.slice(0, index);
  const match = before.match(/([a-zA-Z]+|\d+)[\s,+\-—.]*$/);
  return match ? match[1]!.toLowerCase() : null;
}

// Returns the multiset (with repeats) of quantity values that appear to be
// genuine product-quantity mentions in the message.
function extractCandidateQuantityMentions(message: string): number[] {
  const candidates: number[] = [];

  for (const m of message.matchAll(/\d+/g)) {
    const value = Number(m[0]);
    if (value < MIN_CANDIDATE_QUANTITY || value > MAX_CANDIDATE_QUANTITY) continue;

    const start = m.index!;
    const end = start + m[0].length;
    const next = tokenAt(message, end, "next");
    if (next === "%") continue; // percentage (discount), not a quantity
    if (!next) continue; // nothing follows — not "N <product>"
    if (/^\d+$/.test(next)) continue; // followed by another number, not a product word
    if (QUANTITY_WORD_VALUES.has(next)) continue; // followed by a quantity word — new clause, not this number's product
    if (NON_ITEM_FOLLOWERS.has(next)) continue;

    const prev = tokenAt(message, start, "prev");
    if (prev && NON_ITEM_PRECEDERS.has(prev)) continue;

    candidates.push(value);
  }

  for (const [word, value] of QUANTITY_WORD_VALUES) {
    const pattern = new RegExp(`(^|[^a-z])(${word})([^a-z]|$)`, "gi");
    for (const m of message.matchAll(pattern)) {
      const wordStart = m.index! + m[1]!.length;
      const wordEnd = wordStart + m[2]!.length;
      const next = tokenAt(message, wordEnd, "next");
      if (!next) continue; // nothing follows — not "<quantity-word> <product>"
      // "do" (and other quantity words) can also be a verb ending in
      // Hinglish ("bana do", "kar do" = "make it") rather than the number
      // two — if it's followed by another number or a filler word, it's
      // not "<quantity-word> <product>", same exclusions as the digit loop.
      if (/^\d+$/.test(next)) continue;
      if (QUANTITY_WORD_VALUES.has(next)) continue;
      if (NON_ITEM_FOLLOWERS.has(next)) continue;
      candidates.push(value);
    }
  }

  return candidates;
}

// Multiset difference: candidate quantities left over after matching (by
// value, with repeats) against the model's actual item quantities.
function findUnaccountedQuantityMentions(order: ValidatedOrder, originalMessage: string): number[] {
  const candidates = extractCandidateQuantityMentions(originalMessage);

  const remainingItemQuantities = new Map<number, number>();
  for (const item of order.items) {
    remainingItemQuantities.set(item.quantity, (remainingItemQuantities.get(item.quantity) ?? 0) + 1);
  }

  const unaccounted: number[] = [];
  for (const value of candidates) {
    const remaining = remainingItemQuantities.get(value) ?? 0;
    if (remaining > 0) {
      remainingItemQuantities.set(value, remaining - 1);
    } else {
      unaccounted.push(value);
    }
  }
  return unaccounted;
}

// Approximate: standalone numeric tokens in a string, excluding ones that
// are part of a percentage (e.g. the "10" in "10%"), since those belong to
// the discount field, not an item.
function extractStandaloneNumbers(text: string): number[] {
  const numbers: number[] = [];
  for (const match of text.matchAll(/\d+(?:\.\d+)?/g)) {
    const end = match.index! + match[0].length;
    const isPercent = /^\s*%/.test(text.slice(end, end + 2));
    if (!isPercent) numbers.push(Number(match[0]));
  }
  return numbers;
}

export function computeTrustSignals(order: ValidatedOrder, originalMessage: string): TrustSignals {
  const priceValueCounts = new Map<number, number>();
  for (const item of order.items) {
    priceValueCounts.set(item.unitPrice, (priceValueCounts.get(item.unitPrice) ?? 0) + 1);
  }
  const priceReusedAcrossItems =
    order.items.length > 1 && [...priceValueCounts.values()].some((count) => count > 1);

  const evidenceSeen = new Set<string>();
  let duplicateEvidenceAcrossItems = false;
  for (const item of order.items) {
    const key = normalize(item.evidence);
    if (key.length === 0) continue; // absent evidence is not duplicate evidence
    if (evidenceSeen.has(key)) {
      duplicateEvidenceAcrossItems = true;
      break;
    }
    evidenceSeen.add(key);
  }

  const consumedNumbers = new Set<number>();
  for (const item of order.items) {
    consumedNumbers.add(item.quantity);
    consumedNumbers.add(item.unitPrice);
    for (const n of extractStandaloneNumbers(item.evidence)) consumedNumbers.add(n);
  }
  if (order.discountPercent !== null) consumedNumbers.add(order.discountPercent);

  const allMessageNumbers = extractStandaloneNumbers(originalMessage);
  const unexplainedNumbers = allMessageNumbers.filter((n) => !consumedNumbers.has(n));

  const lowerMessage = originalMessage.toLowerCase();
  const linkageKeywordPresent = LINKAGE_KEYWORDS.some((kw) => lowerMessage.includes(kw));

  const unaccountedQuantityMentions = findUnaccountedQuantityMentions(order, originalMessage);

  return {
    priceReusedAcrossItems,
    duplicateEvidenceAcrossItems,
    unexplainedNumbers,
    linkageKeywordPresent,
    unaccountedQuantityMentions,
  };
}

// The actual routing gate. A price reused across items is common and fine
// on its own (e.g. "naan 60 each, roti 60 each" — two genuinely distinct
// prices that happen to match). It only becomes suspicious when the message
// ALSO contains other numbers the order never accounted for — meaning the
// model may have collapsed several distinct prices into one instead of
// genuinely determining they matched. Duplicate evidence is rejected outright
// regardless of unexplained numbers, since it means the model could not
// actually point to distinct support for two different items.
export function assessTrust(order: ValidatedOrder, originalMessage: string): TrustResult {
  const signals = computeTrustSignals(order, originalMessage);
  const reasons: string[] = [];

  if (signals.duplicateEvidenceAcrossItems) {
    reasons.push("two or more items cite identical supporting text — prices may not be genuinely distinct");
  }
  if (signals.priceReusedAcrossItems && signals.unexplainedNumbers.length > 0) {
    reasons.push(
      `a price is reused across multiple items while the message contains other unexplained number(s) (${signals.unexplainedNumbers.join(", ")}) — the price-to-item mapping may be wrong`,
    );
  }
  if (signals.unaccountedQuantityMentions.length > 0) {
    reasons.push(
      `the message appears to mention ${signals.unaccountedQuantityMentions.length} more item(s) (quantities: ${signals.unaccountedQuantityMentions.join(", ")}) than the interpretation includes — an item may be missing`,
    );
  }

  return { trusted: reasons.length === 0, reasons, signals };
}

// Full pipeline for one provider's raw output: shape validation -> trust
// assessment -> strip evidence. Throws on either stage failing; callers
// (localAiParser.ts, cloudAiParser.ts) don't need to know which stage
// rejected it, but the router logs distinguish TrustRejectedError from a
// plain shape-validation Error for observability.
export function interpretAndTrust(
  order: ValidatedOrder,
  originalMessage: string,
): ParsedOrder {
  const trust = assessTrust(order, originalMessage);
  if (!trust.trusted) {
    throw new TrustRejectedError(
      `This order looks ambiguous: ${trust.reasons.join("; ")}. Please confirm the price for each item separately.`,
      trust.signals,
      order,
    );
  }
  return toParsedOrder(order);
}
