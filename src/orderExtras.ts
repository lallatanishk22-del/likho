import type { BillCharge, BillNote } from "./types.js";
import { classifyNote, dedupeNotes } from "./orderNotes.js";

// The parts of an order that are NOT items.
//
// A real order looks like this:
//
//   2 paneer tikka 180
//   1 butter naan 40
//   3 coke 40
//   delivery 30
//   upi
//   customer Rahul
//
// Sent as written, that was refused: "a price is reused across multiple
// items while the message contains other unexplained number(s) (30)". The
// trust layer was right by its own rules — 40 appears twice and 30 belongs
// to nothing it knows about. It had no concept of a delivery charge, a
// payment mode, or an explicit customer line.
//
// Each of those is a fixed shape, not messy language. So they are read
// here and REMOVED before the message reaches the model — the same move
// that fixed dates and discounts. What is left is three clean item lines,
// which the extractor and the trust layer both handle correctly.

export interface OrderExtras {
  charges: BillCharge[];
  // Money the customer has ALREADY handed over, stated with the order:
  // "500 diya hai baki kitna". Never applied automatically — see
  // parseAdvancePaid below and the button the order handler offers.
  advancePaid: number | null;
  paymentMethod: string | null;
  customer: string | null;
  // What the seller said that is not money: "less spicy", "deliver by
  // 8pm". Captured here rather than sent to the model, which produced no
  // item for it and silently dropped it. See orderNotes.ts.
  notes: BillNote[];
  // The message with all of the above removed.
  rest: string;
}

// Charges a seller adds by name. Deliberately a closed list: an unknown
// word followed by a number is far more likely to be a product than a fee,
// and guessing wrong turns an item into a charge that no discount touches.
const CHARGE_WORDS: Record<string, string> = {
  delivery: "Delivery",
  delivary: "Delivery",
  dilivery: "Delivery",
  shipping: "Delivery",
  ghar: "Delivery",
  pohochana: "Delivery",
  pahuchana: "Delivery",
  pahunchana: "Delivery",
  packing: "Packing",
  packaging: "Packing",
  container: "Packing",
  service: "Service",
  tip: "Tip",
  parcel: "Parcel",
};

// Payment modes, as a seller writes them.
// "500 diya hai" — money already handed over, stated in the same breath as
// the order. Reported: it came back as "I didn't use: 500. If that's a
// charge, send: delivery 500", which is the opposite of what was said.
//
// A closed list, like CHARGE_WORDS and PAYMENT_WORDS. These are the words
// for HANDING OVER money, and the amount must sit beside one of them —
// a bare number is never read as a payment.
//
// It is DETECTED here and applied nowhere. A payment is a financial record
// and the seller confirms it with a tap, exactly as they do from a bill's
// own button. "Do not attempt to infer a successful payment" is the rule,
// and a seller relaying what a customer told them is still hearsay.
const PAID_WORDS =
  /\b(diya|diye|diyaa|dedia|dediya|de\s*diya|de\s*diye|dia|paid|pay\s*kiya|payed|given|gave|advance|adv|jama|bhara)\b/i;

export function parseAdvancePaid(line: string): number | null {
  if (!PAID_WORDS.test(line)) return null;
  // The amount must be adjacent to the word, so "3 paneer roll 120 diya"
  // cannot be read as a payment of 120 for an order line.
  // A "#" makes the number a BILL REFERENCE, not money: "#1042 paid" was
  // being read as a payment of Rs 1042.
  const near =
    line.match(/(?<![#\d])(?:rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?)\s+\S{0,3}\s*(?:diya|diye|dedia|dediya|de\s*diya|dia|paid|given|gave|jama|bhara|advance)/i) ??
    line.match(/(?:paid|advance|adv|jama)\s*[:\-]?\s*(?:rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?)/i);
  if (!near) return null;
  const amount = Number(near[1]);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

const PAYMENT_WORDS: Record<string, string> = {
  upi: "UPI",
  gpay: "UPI",
  googlepay: "UPI",
  phonepe: "UPI",
  paytm: "UPI",
  cash: "Cash",
  nagad: "Cash",
  card: "Card",
  credit: "Card",
  debit: "Card",
  online: "Online",
  bank: "Bank transfer",
  neft: "Bank transfer",
  imps: "Bank transfer",
  cheque: "Cheque",
  check: "Cheque",
};

function titleCaseName(name: string): string {
  return name.replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim();
}

// `isProduct` lets the caller consult the seller's price list without this
// file ever touching the database — the same shape as the numeral expander.
// It defaults to "nothing is a product", which keeps every existing caller
// and every pure test behaving exactly as before.
export function parseOrderExtras(
  text: string,
  isProduct: (phrase: string) => boolean = () => false,
): OrderExtras {
  const charges: BillCharge[] = [];
  const notes: BillNote[] = [];
  let advancePaid: number | null = null;
  let paymentMethod: string | null = null;
  let customer: string | null = null;

  const kept: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    // A TABLE NUMBER IS NOT A QUANTITY — BUT A QUANTITY IS.
    //
    // "room 12 me 3 chai bhejna" was refused for an unexplained 12. The
    // first fix stripped <word> <number> outright, which then ate real
    // orders: "kitchen 2 thali" became "thali" and billed ONE, and
    // "2 counter 40" became "2". Losing a quantity is far worse than the
    // refusal it was meant to prevent.
    //
    // So the price list decides, as everywhere else: the number is only a
    // location when what FOLLOWS it is not something the seller sells.
    // The word list is also cut back to things that genuinely carry a
    // number in a restaurant — "kitchen", "counter" and "floor" were
    // guesses, and every guess here costs a quantity.
    const line = rawLine
      .replace(/\b(table|room|seat|cabin)\s*(?:no\.?|number|#)?\s*(\d{1,3})\b/gi,
        (match, _word, _num, offset: number, whole: string) => {
          // Only the words IMMEDIATELY after the number, and at most two
          // of them. Looking three ahead let the loose product check find
          // "chai" inside "me 3 chai" and refuse to strip "room 12" —
          // containment answers "does this phrase contain a product", and
          // the question here is "is the next word a product".
          const after = whole.slice(offset + match.length).trim().split(/\s+/).slice(0, 2);
          for (let n = after.length; n >= 1; n--) {
            if (isProduct(after.slice(0, n).join(" ").toLowerCase())) return match;
          }
          return " ";
        })
      .replace(/\s{2,}/g, " ")
      .trim();
    if (line.length === 0) continue;

    // "customer Rahul" / "cust: Rahul" / "name Rahul"
    const namedCustomer = line.match(/^(?:customer|cust|name|for)\s*:?\s+(.+)$/i);
    if (namedCustomer && !/\d/.test(namedCustomer[1]!)) {
      customer = titleCaseName(namedCustomer[1]!);
      continue;
    }

    // A NAMED PAYMENT METHOD BEATS A BARE AMOUNT. "paid 300 cash" states
    // both; if the advance check below ran first it would take the 300 and
    // throw the method away.
    // A PAYMENT MAY CARRY ITS AMOUNT: "upi 970", "cash 500", "970 by upi".
    //
    // Reported: "upi 970" matched nothing. It was not a charge (upi is not
    // a charge word), not a note (it carries money), and the payment check
    // below required the line to be a payment word ALONE. So it reached
    // the extractor, which read the line break in
    //
    //   ... 4 roti 15
    //   upi 970
    //
    // as "15 upi" — quantity fifteen of an item called upi — and the whole
    // order was refused for an item that does not exist.
    //
    // Strict on purpose: with the amount removed, what is LEFT must be
    // nothing but payment words. "2 upi 40" is not a payment.
    // Three shapes, so the leading verb is removed first and the remaining
    // two are matched: "upi 970", "970 by upi", and "paid 300 cash" —
    // which is neither until "paid" is taken off the front.
    const payBody = line.replace(/^(paid|pay|payment|mode)\s*:?\s*/i, "").trim();
    const withAmount =
      payBody.match(/^(.+?)\s+(?:rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?)$/i) ??
      payBody.match(/^(?:rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?)\s+(.+)$/i);
    if (withAmount) {
      const [a, b] = [withAmount[1]!, withAmount[2]!];
      const numberFirst = /^[\d.]+$/.test(a);
      const amount = Number(numberFirst ? a : b);
      const words = (numberFirst ? b : a)
        .toLowerCase()
        .replace(/^(paid|pay|payment|mode)\s*:?\s*/i, "")
        .replace(/\b(by|via|through|se|me|mein)\b/gi, " ")
        .replace(/\s+/g, "");
      const withAmountMode = PAYMENT_WORDS[words];
      if (withAmountMode && Number.isFinite(amount) && amount > 0) {
        paymentMethod = withAmountMode;
        // Same rule as "500 diya hai": DETECTED, applied nowhere. The
        // seller taps to put it in the ledger.
        advancePaid = amount;
        continue;
      }
    }

    // "500 diya hai baki kitna" — money already handed over. Checked
    // BEFORE charges, because "500 diya" would otherwise be nothing the
    // charge matcher recognises and would fall through to the model as an
    // item worth 500.
    const advance = parseAdvancePaid(line);
    if (advance !== null) {
      advancePaid = advance;
      continue;
    }

    // A CHARGE IS A CHARGE WORD AND A NUMBER, WHEREVER THE NUMBER SITS.
    //
    // Reported: "ghar bhejna hai 30 lagega" — a Rs 30 home delivery — was
    // not read. The charge matcher required the number at one END of the
    // line, so it also missed "delivery 30 lagega" and "packing 20 extra".
    // Plain English, a known charge word, and still nothing: the gap was
    // structure, not vocabulary.
    //
    // So: exactly one number anywhere in the line, a charge word among the
    // remaining words, and those words must not name something the seller
    // sells. Exactly one number is what keeps a phone number or an item
    // line out — "2 paneer 30" has two, and "call me on 98200" has no
    // charge word.
    const chargeNumbers = [...line.matchAll(/(?:rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?)/gi)];
    if (chargeNumbers.length === 1) {
      const amount = Number(chargeNumbers[0]![1]);
      const phrase = line
        .replace(chargeNumbers[0]![0], " ")
        .toLowerCase()
        .replace(/\b(charges?|fees?)\b/gi, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
      const words = phrase.split(/\s+/).filter(Boolean);
      const label = words.map((w) => CHARGE_WORDS[w]).find((l) => l !== undefined);

      // THE GUARD: the seller's own list wins. If the phrase names
      // something they sell, it is an item at that price, never a fee —
      // otherwise a shop selling "service tea" would bill it as a Service
      // charge that no discount touches.
      if (label && Number.isFinite(amount) && amount > 0 && !isProduct(phrase)) {
        charges.push({ label, amount });
        continue;
      }
    }

    // A line that is ONLY a payment word: "upi", "cash", "paid cash".
    const paymentOnly = line.toLowerCase().replace(/^(paid|pay|payment|mode)\s*:?\s*/i, "").trim();
    const mode = PAYMENT_WORDS[paymentOnly.replace(/\s+/g, "")];
    if (mode) {
      paymentMethod = mode;
      continue;
    }

    // LAST, so every parser above has had its chance. Whatever is left
    // that names no product and states no money is an instruction, not an
    // item — and it must reach the bill rather than the extractor, which
    // makes no item of it and drops it without a word.
    const note = classifyNote(line, isProduct);
    if (note) {
      notes.push(note);
      continue;
    }

    kept.push(line);
  }

  return {
    charges,
    advancePaid,
    paymentMethod,
    customer,
    notes: dedupeNotes(notes),
    rest: kept.join("\n"),
  };
}
