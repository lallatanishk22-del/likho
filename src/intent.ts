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
  | "setup"
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
  | "mock"
  | "customer_history"
  | "outstanding"
  | "business_info"
  | "learned"
  | "forget"
  | "add_item"
  | "remove_item"
  | "set_customer"
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
  // Customer the seller named ("open ravi bill", "ravi paid 500"). Null
  // means they didn't name one, i.e. "the bill I'm working on". Never
  // treat these two as the same: a named customer with no bill is an
  // answer ("no bill for Ravi"), not a licence to show someone else's.
  customer: string | null;
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

// Words that are part of ASKING, not part of the name. Everything here is
// stripped from a message so what remains is the customer the seller
// named — "open ravi bill" leaves "ravi", "show bill" leaves nothing.
const ASK_WORDS = new Set([
  "show", "dikha", "dikhao", "dikhado", "dekh", "dekho", "view", "open",
  "bill", "bills", "billa", "order", "orders", "invoice",
  "ka", "ki", "ke", "kaa", "ko", "na", "ne", "wala", "wali", "walo",
  "the", "my", "a", "an", "for", "of", "to", "me", "please", "pls", "plz",
  "current", "latest", "last", "recent", "this", "that", "is", "was",
  "paid", "payment", "pay", "settled", "received", "diya", "diye", "de",
  "rs", "rupees", "rupee", "full", "amount", "cash", "upi", "online",
  "confirm", "confirmed", "done", "final", "send", "sent", "bhej", "bhejo",
  "pdf", "print", "export",
  "i", "you", "we", "us", "it", "give", "get", "want", "need", "check",
  "made", "make", "bana", "banao", "banaya", "kar", "karo", "kro", "do",
  "kya", "hai", "hain", "and", "with", "on", "in", "at", "sab",
]);

// Pulls the customer's name out of a message that is ABOUT a bill.
// Deliberately conservative: it returns a name only when what is left
// after removing the asking words reads like one (letters, at most three
// words). Anything else returns null, which routes back to "the bill I'm
// working on" — the old behaviour, kept for messages that name nobody.
export function extractCustomer(text: string): string | null {
  // Filtered case-INSENSITIVELY but returned with the seller's own casing,
  // so "Ravi Jerath" is stored as they wrote it. Matching lowercases
  // later; the record should not.
  const words = text
    .replace(/#\s*\d+/g, " ")
    .replace(/[\u20b9]/g, " ")
    .replace(/'s\b/gi, " ")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .filter((w) => !ASK_WORDS.has(w.toLowerCase()))
    // A number is a quantity, a bill number or an amount — never a name.
    .filter((w) => !/\d/.test(w))
    // A lone letter is an initial or a slip, not something to look up.
    .filter((w) => w.length > 1);

  if (words.length === 0 || words.length > 3) return null;
  const name = words.join(" ");
  // One stray letter is a typo, not a customer.
  if (name.replace(/ /g, "").length < 2) return null;
  return name;
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
  const base = {
    text,
    billNo,
    amount: null as number | null,
    customer: null as string | null,
  };

  if (hasWord(lower, "help") || lower === "?" || lower === "start") {
    return { ...base, name: "help" };
  }

  // Re-running setup. Checked before everything else so "setup" is never
  // read as a one-word order for a product called "setup".
  if (/^(setup|set\s*up|start\s*over|onboarding|re-?setup)$/i.test(lower)) {
    return { ...base, name: "setup" };
  }

  // A short message that is ONLY a pleasantry. The length guard matters:
  // "ok 2 paneer" is an order, not an acknowledgement.
  if (GREETINGS.has(lower.replace(/[^a-z ]/g, "").trim()) && !/\d/.test(lower)) {
    return { ...base, name: "greeting" };
  }

  // --- Who owes money --------------------------------------------------
  //
  // Checked BEFORE payment, and this ordering is load-bearing: "who hasn't
  // paid" contains the word "paid", so the payment intent claimed it and
  // marked the open bill PAID IN FULL. A question about money became a
  // change to money. A negated or plural-subject phrase is a REPORT, never
  // a receipt.
  if (
    /\b(who|kaun|kisne)\b/i.test(lower) ||
    /\b(hasn'?t|has\s+not|haven'?t|have\s+not|nahi|nahin)\s+paid\b/i.test(lower) ||
    /\b(unpaid|outstanding|udhaar|udhar|baaki|dues?|pending\s+payments?)\b/i.test(lower)
  ) {
    return { ...base, name: "outstanding" };
  }

  // --- Payment ---------------------------------------------------------
  // Checked BEFORE order, because "Ravi paid 500" contains a name and a
  // number and would otherwise look exactly like an order.
  if (hasWord(lower, "paid", "payment", "settled", "received", "diya", "de", "diye")) {
    const amountMatch = text.match(/(?:rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?)/);
    // Don't read the bill number itself as the amount paid.
    const candidate = amountMatch ? Number(amountMatch[1]) : null;
    const amount = candidate !== null && candidate !== billNo ? candidate : null;
    return { ...base, name: "payment", amount, customer: extractCustomer(text) };
  }

  if (/^(mock|preview|sample)\b/i.test(lower)) {
    return { ...base, name: "mock" };
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
    return { ...base, name: "pdf", customer: extractCustomer(text) };
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

  // Naming a bill that was created without a customer. Without this, a
  // bill whose message never mentioned anyone stayed anonymous forever —
  // and most of them are: the seller types "2 paneer 1 lassi" far more
  // often than they type a name.
  //
  // The digit guard is what keeps this from eating orders: "this is 2
  // paneer" is a person describing food, not naming a customer.
  // The bill number is removed first so "#1042 this is ravi" names #1042
  // instead of falling through to the order parser. billNo already holds
  // it, so nothing is lost by dropping it here.
  const naming = text.replace(/#\s*\d{3,6}/, " ").trim();
  const customerMatch =
    naming.match(/^(?:this is|that'?s|it'?s|its|customer|naam|name)\s*:?\s+(.+)$/i) ??
    naming.match(/^(.+?)\s+ka\s+(?:bill\s+)?(?:hai|h)$/i);
  if (customerMatch && !/\d/.test(customerMatch[1]!)) {
    const named = extractCustomer(customerMatch[1]!);
    if (named) return { ...base, name: "set_customer", customer: named };
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
      return { ...base, name: "show_bill", customer: extractCustomer(text) };
    }
  }

  if (hasWord(lower, "confirm", "done", "send", "sent", "final", "bhej", "ho gaya")) {
    if (!/\d/.test(lower) || billNo !== null) {
      return { ...base, name: "confirm", customer: extractCustomer(text) };
    }
  }

  // --- Customer history --------------------------------------------------
  //
  // Placed LAST on purpose. "show bill", "open bills" and "open ravi bill"
  // are all handled above and must keep their meaning; a greedy history
  // pattern placed earlier swallowed every one of them.
  //
  // Two more guards: the captured name may not be a word that belongs to
  // another intent ("open bills" is not a customer called "open"), and it
  // may not contain a digit ("ravi 2 chai" is an order, not a lookup).
  const NOT_A_NAME = new Set([
    "show", "open", "view", "dekh", "dikha", "see", "get", "list",
    "my", "the", "this", "that", "a", "all", "todays", "today's", "today",
    "pending", "unconfirmed", "unpaid", "draft", "drafts", "last", "latest",
    "current", "recent", "new", "old", "customer", "which", "what",
  ]);

  const historyMatch =
    text.match(/^(?:show|open|see|dekh|dikha)\s+(?:me\s+)?(.+?)(?:'?s)?\s+(?:bills|orders|history|khata)$/i) ??
    text.match(/^(.+?)(?:'?s)?\s+(?:bills|orders|history|khata)$/i) ??
    text.match(/^(?:history|khata)\s+(?:of\s+|for\s+)?(.+)$/i);
  if (historyMatch) {
    const who = historyMatch[1]!.trim();
    const words = who.toLowerCase().split(/\s+/);
    const usable =
      who.length > 0 &&
      !/\d/.test(who) &&
      words.length <= 3 &&
      !words.some((w) => NOT_A_NAME.has(w));
    if (usable) return { ...base, name: "customer_history", text: who };
  }

  const owesMatch =
    text.match(/^how\s+much\s+does\s+(.+?)\s+owes?\b/i) ??
    text.match(/^(.+?)\s+owes?\b/i);
  if (owesMatch) {
    const who = owesMatch[1]!.trim();
    if (who.length > 0 && !/\d/.test(who) && !NOT_A_NAME.has(who.toLowerCase())) {
      return { ...base, name: "customer_history", text: who };
    }
  }

  // Default: an order. This is what makes natural language primary — the
  // seller's normal typing lands here without any command. It produces a
  // DRAFT with a Confirm button, never a committed financial record, so
  // defaulting here is safe even when the classification is wrong.
  return { ...base, name: "order" };
}

// --- Naming a customer, however it is phrased ----------------------------
//
// The first version matched PHRASINGS: "ravi's bills", "history of ravi".
// Real usage looked nothing like that. "dude get me bill of ria", "bill of
// ria", "ria bill", "what about ravi", "ravi ka bill" all fell through to
// the order parser, which then asked which items were on the order — a
// question with no answer, in a loop.
//
// Matching phrasings is whack-a-mole; there is always another way to say
// it. So this asks a STRUCTURAL question instead:
//
//   Does this message contain no items, and does what is left name someone?
//
// Filler and bill-words are stripped, and whatever remains is handed to the
// caller to look up against the seller's real customer list. If nobody by
// that name exists it falls through to the order parser exactly as before,
// so this can only ever add understanding, never take any away.

// Words that carry no identity: politeness, verbs of asking, and the
// bill-words themselves.
const NOT_PART_OF_A_NAME = new Set([
  // address / filler
  "dude", "bhai", "bhaiya", "boss", "sir", "yaar", "man", "ok", "okay", "hey",
  "please", "pls", "plz", "kindly",
  // asking
  "get", "me", "show", "give", "send", "fetch", "find", "bring", "pull",
  "can", "you", "u", "could", "would", "will", "do", "does", "did",
  "i", "want", "need", "check", "chk", "tell", "know", "let", "see", "look",
  "what", "whats", "about", "regarding", "for", "of", "the", "a", "an",
  "my", "his", "her", "their", "is", "was", "are", "and",
  "dekh", "dikha", "batao", "bata", "chahiye", "ka", "ki", "ke", "wala", "wali",
  // bill-words
  "bill", "bills", "order", "orders", "history", "khata", "account",
  "invoice", "invoices", "receipt", "receipts", "detail", "details",
  "previous", "past", "old", "last", "recent", "all", "any",
  // Time words. They are stripped from the NAME but still read from the
  // original message as a date filter, so "yesterday bill of tanishk"
  // resolves to Tanishk AND to yesterday.
  "yesterday", "today", "tomorrow", "kal", "aaj", "week", "weeks", "month",
  "months", "day", "days", "year", "night", "morning", "evening", "this",
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept",
  "oct", "nov", "dec", "january", "february", "march", "april", "june",
  "july", "august", "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);

// Returns the part of the message that could be a person's name, or null.
// Deliberately returns a CANDIDATE, not a decision: only the caller can
// know whether the seller has actually billed anyone by that name.
export function extractCustomerCandidate(text: string): string | null {
  // A message with a quantity in it is an order, not a question about one.
  if (/\d/.test(text)) return null;

  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\s'’]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (words.length === 0 || words.length > 8) return null;

  // The possessive is dropped from the NAME too, not just from the test —
  // "ria's" must be looked up as "ria".
  const kept = words
    .map((w) => w.replace(/['’]s$/, ""))
    .filter((w) => w.length > 0 && !NOT_PART_OF_A_NAME.has(w));
  if (kept.length === 0 || kept.length > 3) return null;

  // Every word was filler except one or two — that is a name-shaped
  // remainder. If it names nobody, the caller falls through to the order
  // parser and nothing is lost.
  return kept.join(" ");
}
