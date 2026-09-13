import type { BillCharge } from "./types.js";

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
  paymentMethod: string | null;
  customer: string | null;
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
  packing: "Packing",
  packaging: "Packing",
  container: "Packing",
  service: "Service",
  tip: "Tip",
  parcel: "Parcel",
};

// Payment modes, as a seller writes them.
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
  let paymentMethod: string | null = null;
  let customer: string | null = null;

  const kept: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    // A TABLE NUMBER IS NOT A QUANTITY.
    //
    // "room 12 me 3 chai bhejna" was refused: "the message appears to
    // mention 1 more item(s) (quantities: 12)". The trust layer was right
    // — 12 was unexplained — but it is a room, not an order of twelve.
    //
    // A closed list, for the same reason as CHARGE_WORDS above: these are
    // the words an Indian restaurant actually numbers, and an unknown word
    // before a number is far more likely to be a product. The number must
    // FOLLOW the word; "2 table" is left alone, since a quantity precedes
    // what it counts.
    const line = rawLine
      .replace(/\b(table|room|seat|counter|cabin|cabin no|kitchen|floor)\s*(?:no\.?|number|#)?\s*\d{1,3}\b/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (line.length === 0) continue;

    // "customer Rahul" / "cust: Rahul" / "name Rahul"
    const namedCustomer = line.match(/^(?:customer|cust|name|for)\s*:?\s+(.+)$/i);
    if (namedCustomer && !/\d/.test(namedCustomer[1]!)) {
      customer = titleCaseName(namedCustomer[1]!);
      continue;
    }

    // "delivery 30" / "30 delivery" / "packing charge 20" / "home delivery 50"
    //
    // Reported: "home delivery 50" was SILENTLY DROPPED. The charge word
    // had to be the whole phrase, so two words matched nothing, the line
    // went to the model as an item, the model produced no item for it, and
    // a Rs 50 charge disappeared from a bill that looked complete. The
    // seller thought they had billed Rs 970.
    //
    // A charge word ANYWHERE in the phrase is enough — the same move as
    // finding a product inside "plate paneer tikka". Sellers write "home
    // delivery", "extra packing", "delivery charges", and the word that
    // identifies the fee is rarely alone.
    const chargeMatch =
      line.match(/^(.+?)\s+(?:rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?)$/i) ??
      line.match(/^(?:rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?)\s+(.+)$/i);
    if (chargeMatch) {
      const [a, b] = [chargeMatch[1]!, chargeMatch[2]!];
      const numberFirst = /^[\d.]+$/.test(a);
      const phrase = (numberFirst ? b : a).toLowerCase().trim();
      const amount = Number(numberFirst ? a : b);

      // THE GUARD: the seller's own list wins. If the phrase names
      // something they sell, it is an item at that price, never a fee —
      // otherwise a shop selling "service tea" would bill it as a Service
      // charge that no discount touches.
      const words = phrase.replace(/\b(charges?|fees?)\b/gi, " ").split(/\s+/).filter(Boolean);
      const label = words.map((w) => CHARGE_WORDS[w]).find((l) => l !== undefined);

      if (label && Number.isFinite(amount) && !isProduct(phrase)) {
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

    kept.push(line);
  }

  return { charges, paymentMethod, customer, rest: kept.join("\n") };
}
