// The conversation layer: decides WHAT the seller is asking for, before
// anything tries to extract an order from it.
//
// Why this exists: until now, text without a slash command was rejected
// ("Send it with /zbill"). That made commands mandatory, which is exactly
// what the product direction forbids. Classification moves the decision
// from the seller's keyboard into code.
//
// Deliberately deterministic. Intent routing decides which financial
// operation runs, so it must be predictable, instant, and testable — the
// model's job is understanding the CONTENT of an order, never deciding
// whether something is an order at all. A model that misclassifies "Ravi
// paid 500" as an order would invent a bill for 500 rupees of nothing.

export type IntentName =
  | "help"
  | "greeting"
  | "show_bill"
  | "confirm"
  | "sales"
  | "open_bills"
  | "prices"
  | "payment"
  | "pdf"
  | "correction"
  | "rename"
  | "bill_format"
  | "business_info"
  | "learned"
  | "forget"
  | "add_item"
  | "remove_item"
  | "order";

export interface Intent {
  name: IntentName;
  // Text the downstream handler should work on (an order, a correction
  // phrase, etc.) — usually the original message.
  text: string;
  // Bill number the seller referenced explicitly ("#1042 paid"). Null means
  // "the bill we're currently working on".
  billNo: number | null;
  // Rupee amount stated with a payment intent ("Ravi paid 500").
  amount: number | null;
}

// "#1042" anywhere in the message names a specific transaction.
function extractBillNo(text: string): number | null {
  const match = text.match(/#\s*(\d{3,6})\b/);
  return match ? Number(match[1]) : null;
}

// Matches whole words only, so "paid" doesn't fire inside "unpaid" and
// "bill" doesn't fire inside "billing".
function hasWord(text: string, ...words: string[]): boolean {
  return words.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, "i").test(text));
}

const GREETINGS = new Set([
  "hi", "hii", "hello", "hey", "yo", "namaste", "namaskar", "hola",
  "thanks", "thank you", "thx", "ty", "ok", "okay", "k", "good morning",
  "good evening", "good night", "gm", "ge",
]);

export function classifyIntent(rawText: string): Intent {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const billNo = extractBillNo(text);
  const base = { text, billNo, amount: null as number | null };

  if (hasWord(lower, "help") || lower === "?" || lower === "start") {
    return { ...base, name: "help" };
  }

  // A short message that is ONLY a pleasantry. The length guard matters:
  // "ok 2 paneer" is an order, not an acknowledgement.
  if (GREETINGS.has(lower.replace(/[^a-z ]/g, "").trim()) && !/\d/.test(lower)) {
    return { ...base, name: "greeting" };
  }

  // --- Payment ---------------------------------------------------------
  // Checked BEFORE order, because "Ravi paid 500" contains a name and a
  // number and would otherwise look exactly like an order.
  if (hasWord(lower, "paid", "payment", "settled", "received", "diya", "de", "diye")) {
    const amountMatch = text.match(/(?:rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?)/);
    // Don't read the bill number itself as the amount paid.
    const candidate = amountMatch ? Number(amountMatch[1]) : null;
    const amount = candidate !== null && candidate !== billNo ? candidate : null;
    return { ...base, name: "payment", amount };
  }

  // Choosing how a bill LOOKS. Checked before "pdf" so "bill format" is
  // never read as a request to export the current bill.
  if (
    /\b(bill\s*)?(format|template|style|design|theme)s?\b/i.test(lower) ||
    /\bhow\s+(my|the)\s+bills?\s+look/i.test(lower)
  ) {
    return { ...base, name: "bill_format" };
  }

  const shopMatch = text.match(/^(?:shop|business|my\s+shop|my\s+business)\s*(.*)$/i);
  if (shopMatch) {
    return { ...base, name: "business_info", text: shopMatch[1]!.trim() };
  }

  if (hasWord(lower, "pdf", "invoice", "print")) {
    return { ...base, name: "pdf" };
  }

  // --- Correction ------------------------------------------------------
  // "actually paneer was 3", "make it 4 naan", "change lassi to 2".
  // Must precede the order check for the same reason payment does.
  if (
    hasWord(lower, "actually", "sorry", "correction", "instead", "galti") ||
    /\b(make|change|update)\s+(it|the)?\s*/i.test(lower) ||
    /\bwas\s+\d/i.test(lower) ||
    /\bnot\s+\d/i.test(lower)
  ) {
    return { ...base, name: "correction" };
  }

  if (/\b(what have you learned|learned words|what you learned|aliases)\b/i.test(lower)) {
    return { ...base, name: "learned" };
  }

  const forgetMatch = text.match(/^forget\s+(.+)$/i);
  if (forgetMatch) {
    return { ...base, name: "forget", text: forgetMatch[1]!.trim() };
  }

  // Renaming a product in the price list. Checked before the edit patterns
  // below so "rename x to y" is never read as adding an item.
  const renameMatch = text.match(/^rename\s+(.+)$/i);
  if (renameMatch) {
    return { ...base, name: "rename", text: renameMatch[1]!.trim() };
  }

  // --- Editing the open bill -------------------------------------------
  // "add 2 samosa" must NOT reach the order parser: it is a deterministic
  // edit to an existing bill, and sending it to the model produced
  // "What is the quantity and price of the samosa?" — the model treating a
  // one-line edit as a whole new order.
  const addMatch = text.match(/^(?:add|plus|aur|and|\+)\s+(.+)$/i);
  if (addMatch) {
    return { ...base, name: "add_item", text: addMatch[1]!.trim() };
  }

  const removeMatch = text.match(/^(?:remove|delete|minus|cancel|hata\s*do|nikal\s*do|-)\s+(.+)$/i);
  if (removeMatch) {
    return { ...base, name: "remove_item", text: removeMatch[1]!.trim() };
  }

  // Asked before "sales" and before "show_bill": "open bills" contains
  // both "bills" and a show-like sense, and must reach its own handler.
  if (
    /\b(open|pending|unconfirmed|unclosed|draft)\s+(bill|bills|orders?)\b/i.test(lower) ||
    /\bbills?\s+(open|pending|unconfirmed)\b/i.test(lower)
  ) {
    return { ...base, name: "open_bills" };
  }

  // "sales", "yesterday sales", "sales 8 sep", "this month ka total".
  // The digit guard is relaxed when "sales" is present so a date in the
  // question ("sales 8 sep") does not make it look like an order.
  if (hasWord(lower, "sales", "kamaya", "kitna") || /\b(today|yesterday|this month|last month|this week)('?s)?\s+(sales|total|business)\b/.test(lower)) {
    return { ...base, name: "sales" };
  }

  if (hasWord(lower, "prices", "price list", "rate", "rates", "menu")) {
    return { ...base, name: "prices" };
  }

  // "show bill", "bill dikha", "#1042", "current bill" — asking to SEE a
  // bill, not to make one. Requires an explicit show-word or a bare bill
  // reference, so "Ravi ka bill bana" still creates one.
  if (
    hasWord(lower, "show", "dikha", "dekh", "view", "open") ||
    (billNo !== null && lower.replace(/#\s*\d+/, "").trim().length === 0)
  ) {
    if (hasWord(lower, "bill", "order") || billNo !== null) {
      return { ...base, name: "show_bill" };
    }
  }

  if (hasWord(lower, "confirm", "done", "send", "sent", "final", "bhej", "ho gaya")) {
    if (!/\d/.test(lower) || billNo !== null) {
      return { ...base, name: "confirm" };
    }
  }

  // Default: an order. This is what makes natural language primary — the
  // seller's normal typing lands here without any command. It produces a
  // DRAFT with a Confirm button, never a committed financial record, so
  // defaulting here is safe even when the classification is wrong.
  return { ...base, name: "order" };
}
