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

// THE RULE ORDER, AND WHY IT IS WHAT IT IS
//
// This layer decides which financial operation runs, so it is deliberately
// deterministic: no model, one pass, first match wins. That makes ORDERING
// the whole design, and ordering is invisible unless it is written down.
// It is written down here.
//
//   0. ORDER SHAPE          a quantity before a product beats every
//                           keyword below. A customer may be called Sales;
//                           a seller may say "paid" in the same sentence
//                           as an order. See looksLikeOrderShape().
//
//   1. QUESTION GUARD       an interrogative can never reach an intent
//                           that changes state. Checking your records must
//                           not change them. See isQuestion().
//
//   then, first match wins:
//
//   help, setup, greeting   cheap exits, no money involved
//   settle_customer         before payment: "cleared all dues" is not the
//                           single-bill payment path
//   outstanding             before payment: "who hasn't paid" contains
//                           "paid" and was marking bills PAID IN FULL
//   payment
//   mock, bill_format,      presentation; before pdf so "bill format" is
//   business_info           not read as an export
//   customer_statement      before pdf: a PDF over a SPAN is a statement
//   pdf
//   correction              before add_item: "make it 4 naan" edits
//   learned, forget, rename
//   set_customer
//   add_item, remove_item   before the reads: they carry quantities
//   open_bills              before sales AND show_bill: "open bills" is
//                           neither a report nor one bill
//   sales, prices
//   show_bill, confirm
//   customer_history        LAST of the reads: an earlier, greedier
//                           version swallowed "show bill" and "open bills"
//   order                   the default. Anything unclaimed is billable,
//                           and the handler then scans for a customer name
//                           before committing to that.
//
// Every line above exists because something broke. Moving one moves money.

import { stripDateExpressions } from "./businessDay.js";
import { parseDiscount } from "./discount.js";

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
  | "set_discount"
  | "keep_only"
  | "rename"
  | "bill_format"
  | "mock"
  | "customer_history"
  | "customer_statement"
  | "outstanding"
  | "settle_customer"
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

// Intents that CHANGE money or state. A question must never reach one.
// EVERY intent that changes state belongs here. A new one that is left out
// silently loses the question guard — "did i add 10 percent discount" would
// have APPLIED one, which is the exact failure this set exists to prevent.
const MUTATING: ReadonlySet<IntentName> = new Set<IntentName>([
  "confirm", "payment", "settle_customer", "correction", "add_item",
  "remove_item", "rename", "forget", "set_discount", "keep_only",
  "set_customer", "business_info",
]);

// Is the seller ASKING rather than TELLING?
//
// "dude did i confirm tanishks bill" was routed to confirm — a question
// about whether something happened was about to make it happen, and it had
// even taken "dude did tanishks" as the customer name. A seller checking
// their records must never change them by doing so.
export function isQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    t.endsWith("?") ||
    /^(did|do|does|have|has|had|is|are|was|were|can|could|should|will|would|am)\b/.test(t) ||
    /^(dude|bhai|boss|yaar|man|hey|ok|okay|so)\s+(did|do|does|have|has|is|are|was|were|can|could|kya)\b/.test(t) ||
    /\b(kya|kitna|kitne|kaun|kaunsa)\b/.test(t) ||
    /^(how|what|which|who|when|where|why)\b/.test(t)
  );
}

// --- THE PRECEDENCE RULE THIS LAYER WAS MISSING --------------------------
//
// 26 keyword rules ran before the order check, so any message whose words
// happened to collide with a keyword was stolen from billing:
//
//   "sales 2 chai"                 -> the sales report   (order lost)
//   "paid 2 paneer"                -> a PAYMENT of Rs 2  (money bug)
//   "ravi 2 chai and mark it paid" -> a payment          (order lost)
//
// The last is not exotic: noting that an order was paid, in the same
// breath as the order, is how people talk.
//
// In a billing product a QUANTITY BEFORE A PRODUCT is the strongest signal
// there is, and it beats every keyword. A customer may be called Sales; a
// seller may say "paid" in the same sentence as an order. Neither changes
// what the message IS.
//
// Excluded deliberately: messages that OPEN with an action verb ("add 2
// samosa", "make it 4 naan") are editing an existing bill, and questions,
// which never act at all.
const ACTION_OPENERS =
  /^(add|plus|remove|minus|delete|cancel|drop|confirm|mark|set|rename|forget|make|change|update|show|open|give|send|get|bring|shop|business|settle|clear)\b/i;

// A bill reference (#1042) is not a quantity.
const QUANTITY_BEFORE_WORD = /(^|[^#\d])\b(\d{1,3})\s+([a-z]{2,})/i;

// Words that make the number a price or a unit, not a count of something.
const NOT_A_PRODUCT_AFTER_NUMBER =
  /^(rs|rupees|rupee|each|only|percent|off|paid|due|bill|bills|more|less|total|ka|ki|ke|se|me|and|aur)$/i;

export function looksLikeOrderShape(text: string): boolean {
  // "sales 8 sep" is a date, not eight sepsomethings. Dates are stripped
  // first, exactly as they are before a customer-name lookup.
  const t = stripDateExpressions(text).trim();
  if (t.length === 0) return false;
  if (isQuestion(t)) return false;
  if (ACTION_OPENERS.test(t)) return false;

  const m = t.match(QUANTITY_BEFORE_WORD);
  if (!m) return false;
  return !NOT_A_PRODUCT_AFTER_NUMBER.test(m[3]!);
}

export function classifyIntent(rawText: string): Intent {
  const asked = isQuestion(rawText);

  // Order shape wins over every keyword. See the note above.
  if (looksLikeOrderShape(rawText)) {
    const shaped = classifyIntentInner(rawText);
    // Only intents that would STEAL the order are overridden; genuine
    // bill-editing intents ("add 2 chai") never reach here anyway.
    const STEALABLE = new Set<IntentName>([
      "sales", "payment", "prices", "outstanding", "settle_customer",
      "customer_history", "customer_statement", "show_bill", "confirm",
      "open_bills", "pdf", "mock", "learned",
    ]);
    if (STEALABLE.has(shaped.name)) return { ...shaped, name: "order" };
    return shaped;
  }

  const decided = classifyIntentInner(rawText);

  // A question is answered, never acted on. Confirming, paying and
  // settling all fall back to the read-only view of the same subject.
  if (asked && MUTATING.has(decided.name)) {
    // A question about a specific bill number can still open that bill.
    if (decided.billNo) return { ...decided, name: "show_bill" };

    // Otherwise answer about the PERSON. The customer field is dropped:
    // it was filled by a parser built for commands and had taken "dude did
    // tanishks" as a name. The handler rescans the message against the
    // seller's real customer list instead.
    return { ...decided, name: "customer_history", customer: null };
  }
  return decided;
}

function classifyIntentInner(rawText: string): Intent {
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

  // --- Settling someone's account -------------------------------------
  //
  // Checked before both payment and the outstanding report. "tanishk
  // cleared all his dues" is a STATEMENT about a person; it was being
  // answered with "Nobody owes you anything" because it contains "dues".
  // And "mark all bills paid by tanishk" reached the single-bill payment
  // path, which could only ask which number.
  // Matched on WORD STEMS, not exact spellings. A seller typed "cleard"
  // and the whole thing fell through to the outstanding report, because
  // "cleared|clears" did not cover a dropped letter. Sellers type fast;
  // matching "clear..." and "settl..." costs nothing and survives typos.
  const SETTLE_VERB = /\b(clear\w*|settl\w*|chukta|chuka|nipta\w*)\b/i;
  const SETTLE_OBJECT =
    /\b(due|dues|bill|bills|amount|paisa|paise|udhaar|udhar|baaki|everything|khata|account|sab|sabkuch)\b/i;

  if (
    (SETTLE_VERB.test(lower) && SETTLE_OBJECT.test(lower)) ||
    (/\b(all|sab|sare|saare)\b/i.test(lower) &&
      /\b(bill|bills|due|dues)\b/i.test(lower) &&
      /\b(paid|clear\w*|settl\w*|mark)\b/i.test(lower)) ||
    /\bmark\b.*\ball\b.*\b(paid|clear)/i.test(lower)
  ) {
    return { ...base, name: "settle_customer" };
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

  // Asking for the whole account as a document. Checked before plain
  // history so "lifetime bill of ria" produces a PDF rather than a chat
  // list — the seller asked for something they can send on.
  if (
    /\b(lifetime|life time|statement|ledger|account\s+summary|full\s+(bill|record|history))\b/i.test(lower) ||
    (/\b(monthly|weekly|yearly)\b/i.test(lower) && /\b(bill|bills|statement|report|summary|total)\b/i.test(lower)) ||
    // A PDF request is only a STATEMENT when it asks for a SPAN: a period,
    // "lifetime", or plural "bills". "ravi bill pdf" — singular, no period
    // — means that one bill, and must stay the single-bill export.
    (/\b(pdf|print|download)\b/i.test(lower) &&
      (/\b(bills|statement|ledger|khata|account)\b/i.test(lower) ||
        /\b(lifetime|life time|monthly|weekly|yearly|today|yesterday|kal|this\s+(week|month|year)|last\s+(week|month|year))\b/i.test(lower)))
  ) {
    return { ...base, name: "customer_statement" };
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

  // Answering the duplicate question in words rather than by tapping.
  // "keep only cake" was reaching the ORDER parser, which replied
  // "Quantity for cake (1) isn't clearly supported".
  const keepMatch = text.match(/^keep\s+(?:only\s+|just\s+)?(.+?)\s*$/i);
  if (keepMatch && !/\d/.test(keepMatch[1]!)) {
    return { ...base, name: "keep_only", text: keepMatch[1]!.replace(/^["']|["']$/g, "").trim() };
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

  // A DISCOUNT ON A BILL THAT ALREADY EXISTS.
  //
  // "add a discount in the order 5 percent" was routed to add_item by the
  // leading "add", and replied '"a" isn\'t a quantity'. No word list was
  // needed to tell these apart, and none was added: the discount parser
  // already finds the percentage, and what it leaves behind answers the
  // rest of the question.
  //
  //   "dhruv 2 cakes 20% off"      remainder IS an order  -> bill it
  //   "add 5 percent discount"     remainder is NOT       -> discount the
  //                                                         open bill
  //
  // Extract what is deterministic first, then classify what is left. That
  // is the same move that fixed dates, and it needs no vocabulary at all.
  const discountHere = parseDiscount(text);
  if (discountHere.percent !== null && !looksLikeOrderShape(discountHere.rest)) {
    return { ...base, name: "set_discount", amount: discountHere.percent };
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

// NOTE: extracting a customer name by stripping filler words used to live
// here. It was replaced by findCustomerInMessage() in customerStore.ts,
// which scans the message for names the seller ACTUALLY has rather than
// trying to enumerate English filler. Keeping both would have left two
// answers to "who does this message name", and they would have drifted.
