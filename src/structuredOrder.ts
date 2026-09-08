import type { OrderItem } from "./types.js";

// The model's raw interpretation, before any trust is extended to it.
// "evidence" is the model's claimed justification for an item's quantity and
// price — a literal quote from the original message. It does NOT make the
// value correct by itself: validateStructuredShape() below checks each
// item's evidence individually against the real message (existence-level
// checks), and trustLayer.ts separately checks the RELATIONSHIPS between
// items — evidence alone cannot prove those.
export interface StructuredItem {
  name: string;
  quantity: number;
  unitPrice: number;
  evidence: string;
  // Where this price came from: "stated" = the seller wrote it in this
  // message (message-grounded, model-supplied, strictly checked);
  // "catalog" = looked up deterministically from the seller's price store.
  // Optional: absent means "stated", so anything that does not explicitly
  // declare catalog provenance gets the strict check by default.
  priceSource?: "stated" | "catalog";
}

export interface StructuredInterpretation {
  status: "valid" | "clarification";
  customer: string | null;
  items: StructuredItem[];
  discountPercent: number | null;
  clarification: string | null;
}

// Output of shape validation: individually well-formed and grounded, but
// NOT YET trusted — that's the trust layer's job, since it requires looking
// at all items together against the message, which this stage doesn't do.
export interface ValidatedOrder {
  customer: string | null;
  items: StructuredItem[];
  discountPercent: number | null;
}

// What's allowed to reach the deterministic calculator, once the trust layer
// has approved a ValidatedOrder. No evidence, no status — internal to the
// parsing/validation/trust boundary.
export interface ParsedOrder {
  customer: string | null;
  items: OrderItem[];
  discountPercent: number | null;
}

export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// Hard boundary: an item's evidence must be text that actually exists in
// what the seller typed, not a plausible-sounding paraphrase.
function evidenceIsGrounded(evidence: string, originalMessage: string): boolean {
  const normEvidence = normalize(evidence);
  return normEvidence.length > 0 && normalize(originalMessage).includes(normEvidence);
}

// Hard boundary: the number itself must appear in the cited evidence, as a
// standalone token (so 60 cannot match inside 160). This is what catches a
// model reporting a price/quantity that isn't the one it actually quoted.
export function numberAppearsIn(value: number, text: string): boolean {
  const pattern = new RegExp(`(^|[^0-9])${value}([^0-9]|$)`);
  return pattern.test(text);
}

// Common spelled-out quantity words (English + Hinglish transliterations).
// Quantities in casual WhatsApp orders are almost always small, and writing
// "one"/"ek" states the quantity just as explicitly as "1" — it's a
// different token, not a missing one. Prices and discounts are NOT covered
// by this: spelled-out currency amounts aren't a real pattern here, so
// numberAppearsIn (digit-only) stays exactly as-is for those.
export const QUANTITY_WORDS: Record<number, string[]> = {
  1: ["one", "ek"],
  2: ["two", "do"],
  3: ["three", "teen", "tin"],
  4: ["four", "char", "chaar"],
  5: ["five", "paanch", "panch"],
  6: ["six", "chhe", "che"],
  7: ["seven", "saat"],
  8: ["eight", "aath", "aat"],
  9: ["nine", "nau"],
  10: ["ten", "das", "dus"],
};

function quantityWordAppearsIn(value: number, text: string): boolean {
  const words = QUANTITY_WORDS[value];
  if (!words) return false;
  const lower = text.toLowerCase();
  return words.some((word) => new RegExp(`(^|[^a-z])${word}([^a-z]|$)`).test(lower));
}

// Quantity-specific grounding: a literal digit OR a recognized spelled-out
// number word. A quantity that's neither — e.g. an unstated default the
// model invented with no basis anywhere in the message — still fails,
// preserving "every item must have an explicit quantity."
export function quantityAppearsIn(value: number, text: string): boolean {
  return numberAppearsIn(value, text) || quantityWordAppearsIn(value, text);
}

// Stage 1: shape validation. Checks that each item, IN ISOLATION, is
// well-formed and its evidence is grounded in the real message. Does NOT
// check relationships between items (e.g. price reuse, unexplained numbers)
// — that is the trust layer's responsibility, because it requires reasoning
// about the whole order at once, not one item at a time.
export function validateStructuredShape(
  raw: Record<string, unknown>,
  originalMessage: string,
): ValidatedOrder {
  if (raw["status"] !== "valid" && raw["status"] !== "clarification") {
    throw new Error("Model returned an unrecognized response. Please resend the order.");
  }

  if (raw["status"] === "clarification") {
    const clarification =
      typeof raw["clarification"] === "string" && raw["clarification"].trim().length > 0
        ? raw["clarification"]
        : "I couldn't understand this order confidently. Please resend the items and quantities.";
    throw new Error(clarification);
  }

  if (!Array.isArray(raw["items"]) || raw["items"].length === 0) {
    throw new Error("Couldn't find any items in this order. Please resend the items and quantities.");
  }

  const items: StructuredItem[] = (raw["items"] as unknown[]).map((rawItem, index) => {
    const item = rawItem as Record<string, unknown>;

    if (typeof item["name"] !== "string" || item["name"].trim().length === 0) {
      throw new Error(`Item ${index + 1} has no name. Please resend the order.`);
    }
    const name = item["name"].trim();

    if (
      typeof item["quantity"] !== "number" ||
      !Number.isInteger(item["quantity"]) ||
      item["quantity"] <= 0
    ) {
      throw new Error(`Invalid quantity for "${name}". Please confirm the quantity.`);
    }
    if (typeof item["unitPrice"] !== "number" || item["unitPrice"] <= 0) {
      throw new Error(`No price found for "${name}". Please state the price, e.g. "${name} ₹100 each".`);
    }
    if (typeof item["evidence"] !== "string" || item["evidence"].trim().length === 0) {
      throw new Error(`No supporting text found for "${name}". Please confirm the quantity and price.`);
    }

    const quantity = item["quantity"] as number;
    const unitPrice = item["unitPrice"] as number;
    const evidence = item["evidence"] as string;
    // Set by catalog.ts's resolvePrices() for prices supplied by the price
    // store. Absent (undefined) for anything coming straight from a model.
    const priceSource = item["priceSource"] === "catalog" ? "catalog" : "stated";

    if (!evidenceIsGrounded(evidence, originalMessage)) {
      throw new Error(
        `Couldn't verify "${name}"'s price/quantity against your message. Please resend clearly.`,
      );
    }
    // Quantity and price are grounded INDEPENDENTLY against the whole
    // original message, not required to both sit inside one short evidence
    // quote. Natural phrasing often separates them ("bhai 2 thali 180 ki
    // aur..." — quantity and price several words apart) — requiring
    // co-location rejected correct extractions. Each number must still
    // exist verbatim in what the seller typed, so an invented number that
    // appears nowhere in the message is still caught.
    if (!quantityAppearsIn(quantity, originalMessage)) {
      throw new Error(`Quantity for "${name}" (${quantity}) isn't clearly supported by the message. Please confirm.`);
    }
    // Message-grounding applies ONLY to prices the model claims were stated
    // in the message — that check exists to catch an LLM inventing a number.
    // A "catalog" price was never chosen by the model at all: it came from a
    // deterministic lookup in the seller's own price store (catalog.ts), so
    // it is trusted by provenance and is legitimately absent from the
    // message text. Anything without an explicit "catalog" marker is treated
    // as model-supplied and checked exactly as before — the default is the
    // strict path, never the permissive one.
    if (priceSource !== "catalog" && !numberAppearsIn(unitPrice, originalMessage)) {
      throw new Error(`Price for "${name}" (₹${unitPrice}) isn't clearly supported by the message. Please confirm.`);
    }

    return { name, quantity, unitPrice, evidence, priceSource };
  });

  let discountPercent: number | null = null;
  if (typeof raw["discountPercent"] === "number" && raw["discountPercent"] > 0) {
    if (!numberAppearsIn(raw["discountPercent"], originalMessage)) {
      throw new Error("Discount percentage isn't clearly stated in the message. Please confirm.");
    }
    discountPercent = raw["discountPercent"];
  }

  const customer =
    typeof raw["customer"] === "string" && raw["customer"].trim().length > 0
      ? raw["customer"].trim()
      : null;

  return { customer, items, discountPercent };
}

// Strips evidence — the only shape allowed past the trust boundary.
export function toParsedOrder(order: ValidatedOrder): ParsedOrder {
  return {
    customer: order.customer,
    discountPercent: order.discountPercent,
    items: order.items.map(({ name, quantity, unitPrice }) => ({ name, quantity, unitPrice })),
  };
}
