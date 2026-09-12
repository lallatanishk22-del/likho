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

export function parseOrderExtras(text: string): OrderExtras {
  const charges: BillCharge[] = [];
  let paymentMethod: string | null = null;
  let customer: string | null = null;

  const kept: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    // "customer Rahul" / "cust: Rahul" / "name Rahul"
    const namedCustomer = line.match(/^(?:customer|cust|name|for)\s*:?\s+(.+)$/i);
    if (namedCustomer && !/\d/.test(namedCustomer[1]!)) {
      customer = titleCaseName(namedCustomer[1]!);
      continue;
    }

    // "delivery 30" / "30 delivery" / "packing charge 20"
    const chargeMatch =
      line.match(/^([a-z]+)(?:\s+charges?|\s+fee)?\s+(?:rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?)$/i) ??
      line.match(/^(?:rs\.?|₹)?\s*(\d+(?:\.\d{1,2})?)\s+([a-z]+)(?:\s+charges?|\s+fee)?$/i);
    if (chargeMatch) {
      const [a, b] = [chargeMatch[1]!, chargeMatch[2]!];
      const word = (/^\d/.test(a) ? b : a).toLowerCase();
      const amount = Number(/^\d/.test(a) ? a : b);
      const label = CHARGE_WORDS[word];
      if (label && Number.isFinite(amount)) {
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
