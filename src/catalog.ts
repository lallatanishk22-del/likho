// Seller price store + deterministic price resolution.
//
// This is the layer that makes "2 paneer, 4 samosa" (no prices in the
// message) billable. The pricing hierarchy is:
//   1. Price explicitly stated in the message  -> already grounded and
//      checked by structuredOrder.ts, untouched here.
//   2. Price from the seller's stored catalog  -> supplied HERE, by exact
//      deterministic lookup. The LLM never sees or chooses it.
//   3. Neither -> left unresolved, which becomes a clarification.
//
// Matching is deliberately strict: exact name, registered alias, or simple
// singular/plural. NO fuzzy/edit-distance matching — a near-miss would
// silently attach the wrong price to an item, which is exactly the class of
// error the whole trust layer exists to prevent. An unmatched item asks the
// seller instead of guessing.

export interface CatalogProduct {
  id: string;
  name: string;
  price: number;
  aliases: string[];
}

export interface PriceCatalog {
  businessId: string;
  products: CatalogProduct[];
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

// "samosas" -> "samosa", "rotis" -> "roti". Only strips a trailing plural
// "s"/"es"; does not attempt real morphology.
function singularize(name: string): string {
  if (name.endsWith("es") && name.length > 3) return name.slice(0, -2);
  if (name.endsWith("s") && name.length > 2) return name.slice(0, -1);
  return name;
}

function candidateKeys(name: string): string[] {
  const norm = normalizeName(name);
  const keys = new Set<string>([norm, singularize(norm)]);
  return [...keys].filter((k) => k.length > 0);
}

// Builds an exact-match index: every product name and alias, plus their
// singular forms, all pointing at the product. Collisions (two products
// claiming the same key) are recorded as ambiguous and will refuse to
// resolve rather than pick one.
interface CatalogIndex {
  byKey: Map<string, CatalogProduct>;
  ambiguousKeys: Set<string>;
}

export function buildCatalogIndex(catalog: PriceCatalog): CatalogIndex {
  const byKey = new Map<string, CatalogProduct>();
  const ambiguousKeys = new Set<string>();

  for (const product of catalog.products) {
    const names = [product.name, ...product.aliases];
    for (const rawName of names) {
      for (const key of candidateKeys(rawName)) {
        const existing = byKey.get(key);
        if (existing && existing.id !== product.id) {
          ambiguousKeys.add(key);
        } else {
          byKey.set(key, product);
        }
      }
    }
  }

  return { byKey, ambiguousKeys };
}

// Thrown when prices cannot be resolved from the price store. Distinct
// type because this outcome is DETERMINISTIC — it comes from the seller's
// database, not from a model's judgement — so retrying on a different
// model cannot change it. The router short-circuits instead of escalating.
export class CatalogResolutionError extends Error {
  unresolved: UnresolvedItem[];
  constructor(message: string, unresolved: UnresolvedItem[]) {
    super(message);
    this.name = "CatalogResolutionError";
    this.unresolved = unresolved;
  }
}

export type PriceSource = "stated" | "catalog";

export interface ResolvedItem {
  name: string;
  quantity: number;
  unitPrice: number;
  priceSource: PriceSource;
  productId: string | null;
  evidence: string;
}

export interface UnresolvedItem {
  name: string;
  reason: "not_in_catalog" | "ambiguous_in_catalog";
}

export interface PriceResolution {
  resolved: ResolvedItem[];
  unresolved: UnresolvedItem[];
}

// Raw item shape as it arrives from the extraction model: unitPrice may be
// null, meaning "the seller did not state a price in this message".
export interface RawExtractedItem {
  name: string;
  quantity: number;
  unitPrice: number | null;
  evidence: string;
}

// Pure function — no I/O, fully unit-testable. Fills in catalog prices for
// items the model reported without one, and reports the rest as unresolved
// so the caller can ask the seller instead of inventing a number.
export function resolvePrices(
  items: RawExtractedItem[],
  catalog: PriceCatalog,
): PriceResolution {
  const index = buildCatalogIndex(catalog);
  const resolved: ResolvedItem[] = [];
  const unresolved: UnresolvedItem[] = [];

  for (const item of items) {
    // Price stated in the message wins outright — it is the seller's
    // explicit instruction for this order, and it stays subject to the
    // existing message-grounding check downstream.
    if (typeof item.unitPrice === "number" && item.unitPrice > 0) {
      const match = candidateKeys(item.name)
        .map((k) => index.byKey.get(k))
        .find((p): p is CatalogProduct => p !== undefined);
      resolved.push({
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        priceSource: "stated",
        productId: match?.id ?? null,
        evidence: item.evidence,
      });
      continue;
    }

    const keys = candidateKeys(item.name);

    if (keys.some((k) => index.ambiguousKeys.has(k))) {
      unresolved.push({ name: item.name, reason: "ambiguous_in_catalog" });
      continue;
    }

    const match = keys
      .map((k) => index.byKey.get(k))
      .find((p): p is CatalogProduct => p !== undefined);

    if (!match) {
      unresolved.push({ name: item.name, reason: "not_in_catalog" });
      continue;
    }

    resolved.push({
      name: item.name,
      quantity: item.quantity,
      unitPrice: match.price,
      priceSource: "catalog",
      productId: match.id,
      evidence: item.evidence,
    });
  }

  return { resolved, unresolved };
}

// Human-readable message for the seller when prices can't be resolved.
export function describeUnresolved(unresolved: UnresolvedItem[]): string {
  const notInCatalog = unresolved.filter((u) => u.reason === "not_in_catalog");
  const ambiguous = unresolved.filter((u) => u.reason === "ambiguous_in_catalog");

  const parts: string[] = [];
  if (notInCatalog.length > 0) {
    const names = notInCatalog.map((u) => `"${u.name}"`).join(", ");
    parts.push(
      `I don't have a price for ${names}. Add it to your price list, or state the price in the order.`,
    );
  }
  if (ambiguous.length > 0) {
    const names = ambiguous.map((u) => `"${u.name}"`).join(", ");
    parts.push(`${names} matches more than one product in your price list. Please be more specific.`);
  }
  return parts.join(" ");
}

// Bridges raw model output -> price-resolved raw output, ready for
// validateStructuredShape(). A no-op when no catalog is supplied, so every
// existing caller (CLI, eval harness) keeps today's exact behaviour: prices
// must be stated in the message.
//
// Throws with a seller-facing message when prices can't be resolved, which
// the router treats the same as any other clarification.
export function applyCatalog(
  raw: Record<string, unknown>,
  catalog: PriceCatalog | undefined,
): Record<string, unknown> {
  if (!catalog) return raw;
  if (raw["status"] !== "valid" || !Array.isArray(raw["items"])) return raw;

  const rawItems = raw["items"] as Record<string, unknown>[];

  // Only hand well-formed entries to resolvePrices; anything malformed is
  // passed through untouched so validateStructuredShape reports it with its
  // own (already tested) error message rather than crashing here.
  const candidates: RawExtractedItem[] = [];
  for (const item of rawItems) {
    if (typeof item["name"] !== "string" || typeof item["quantity"] !== "number") return raw;
    const price = item["unitPrice"];
    candidates.push({
      name: item["name"],
      quantity: item["quantity"],
      unitPrice: typeof price === "number" ? price : null,
      evidence: typeof item["evidence"] === "string" ? item["evidence"] : "",
    });
  }

  const { resolved, unresolved } = resolvePrices(candidates, catalog);

  if (unresolved.length > 0) {
    throw new CatalogResolutionError(describeUnresolved(unresolved), unresolved);
  }

  return {
    ...raw,
    items: resolved.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      evidence: item.evidence,
      priceSource: item.priceSource,
      productId: item.productId,
    })),
  };
}
