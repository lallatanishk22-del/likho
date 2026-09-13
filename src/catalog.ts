import { editDistance, distanceBudget, squeezeRepeats, squeezeSpaces, normalizeName } from "./nearName.js";

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
// Matching runs in tiers, strictest first:
//   1. exact name / registered alias / simple singular-plural
//   2. repeat-squeezed  ("lasssi" -> "lassi", "daal" -> "dal")
//   3. edit distance, length-scaled, with a UNIQUE winner required
//
// Tiers 2 and 3 exist because a real seller types "lasssi" and "panner",
// and refusing to bill over one letter is useless. They are kept safe by
// three rules, not by optimism:
//   - the typed name must be long enough for a typo to be distinguishable
//     from a different product ("tea"/"sea" are never matched)
//   - exactly ONE product may be within range; a tie refuses and asks
//   - the CANONICAL catalog name goes on the bill, so a wrong match is
//     visible to the seller before they confirm
//
// This is deliberately NOT embeddings/RAG. Semantic similarity is the wrong
// question: "lassi" and "chai" are both cold drinks and score highly, while
// "lassi"/"lasssi" is a spelling accident with no semantic content at all.
// Edit distance measures the thing that actually went wrong.

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
  // Tier 2: repeat-squeezed forms of every name and alias.
  bySqueezed: Map<string, CatalogProduct>;
  ambiguousSqueezed: Set<string>;
  // Tier 3 search space: every known key, for edit-distance comparison.
  allKeys: { key: string; product: CatalogProduct }[];
}

export function buildCatalogIndex(catalog: PriceCatalog): CatalogIndex {
  const byKey = new Map<string, CatalogProduct>();
  const ambiguousKeys = new Set<string>();
  const bySqueezed = new Map<string, CatalogProduct>();
  const ambiguousSqueezed = new Set<string>();
  const allKeys: { key: string; product: CatalogProduct }[] = [];

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
        allKeys.push({ key, product });

        const squeezed = squeezeRepeats(key);
        const existingSqueezed = bySqueezed.get(squeezed);
        if (existingSqueezed && existingSqueezed.id !== product.id) {
          ambiguousSqueezed.add(squeezed);
        } else {
          bySqueezed.set(squeezed, product);
        }
      }
    }
  }

  return { byKey, ambiguousKeys, bySqueezed, ambiguousSqueezed, allKeys };
}

export type MatchKind = "exact" | "near";

export interface CatalogMatch {
  product: CatalogProduct;
  kind: MatchKind;
}

// The full tiered lookup. Returns null when nothing is close enough, and
// "ambiguous" when more than one product is equally close — which must ask
// the seller, never pick a side.
// Every product within reach of a name, best first. Used to offer the
// seller a choice when a single answer cannot be justified.
export function findCandidates(name: string, index: CatalogIndex): CatalogProduct[] {
  const keys = candidateKeys(name);
  const typed = keys[0] ?? "";
  const scored = new Map<string, { product: CatalogProduct; distance: number }>();

  for (const key of keys) {
    const exact = index.byKey.get(key);
    if (exact) scored.set(exact.id, { product: exact, distance: 0 });
  }

  const despaced = squeezeSpaces(typed);
  const squeezed = squeezeRepeats(typed);
  const budget = Math.max(distanceBudget(typed.length), 1);

  for (const { key, product } of index.allKeys) {
    if (scored.has(product.id)) continue;
    let distance: number | null = null;
    if (squeezeSpaces(key) === despaced || squeezeRepeats(key) === squeezed) {
      distance = 1;
    } else {
      const d = editDistance(typed, key, budget);
      if (d <= budget) distance = d;
    }
    if (distance !== null) scored.set(product.id, { product, distance });
  }

  return [...scored.values()]
    .sort((a, b) => a.distance - b.distance || a.product.name.localeCompare(b.product.name))
    .map((x) => x.product);
}

// THE SELLER'S OWN LIST DECIDES WHAT IS A PRODUCT.
//
// A model handed "2 plate paneer tikka" reports the item as "plate paneer
// tikka", and the whole order dies on "I don't have a price for that".
// The same happens for every container word ("plate", "glass", "dabba",
// "packet"), every adjective ("garam", "thanda", "extra spicy") and every
// language they might be typed in.
//
// There is no list of words that fixes this — that is the trap. "garam"
// is Hindi, "sada" is Marathi, "sukha" is Gujarati, and tomorrow someone
// types "2 large paneer tikka". The seller's price list, though, is
// GROUND TRUTH: it is the complete set of things they actually sell.
//
// So: look for a catalog product INSIDE the reported name.
//
//   "plate paneer tikka"  contains  "paneer tikka"   -> Paneer Tikka
//   "thanda coke"         contains  "coke"           -> Coke
//
// Discipline, identical to the near-matching rules next door:
//   - LONGEST window wins, so "paneer roll" always beats "paneer".
//   - Two DIFFERENT products at the same length is a refusal, not a
//     coin toss.
//   - The window is matched with the full tiered lookup, so a misspelling
//     inside a wrapped phrase ("1 plate panner tikka") still resolves.
//   - A window that is only digits is never a product.
//
// The canonical name is what prints on the bill, so the seller sees
// "Paneer Tikka × 2" in the preview and can catch a wrong match before
// confirming. That is the same safety that makes near-matching acceptable.
export function findProductByContainment(
  name: string,
  index: CatalogIndex,
): CatalogMatch | "ambiguous" | null {
  const tokens = name.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  // A single token cannot CONTAIN anything — findProduct already judged it.
  if (tokens.length < 2) return null;

  for (let size = tokens.length - 1; size >= 1; size--) {
    const hits: CatalogProduct[] = [];
    let sawAmbiguous = false;

    for (let start = 0; start + size <= tokens.length; start++) {
      const window = tokens.slice(start, start + size);
      if (window.every((t) => /^\d+$/.test(t))) continue;

      const found = findProduct(window.join(" "), index);
      if (found === "ambiguous") { sawAmbiguous = true; continue; }
      if (found === null) continue;
      if (!hits.some((p) => p.id === found.product.id)) hits.push(found.product);
    }

    if (hits.length === 1) return { product: hits[0]!, kind: "near" };
    // Two different products of equal length inside one name is a genuine
    // ambiguity ("paneer tikka roll" when both exist) — ask, never guess.
    if (hits.length > 1 || sawAmbiguous) return "ambiguous";
  }

  return null;
}

// "WOH CHEESE WALA BHI" — A REFERENCE, NOT A NAME.
//
// Hindi points at things: "woh cheese wala" is "that cheese one", "paneer
// wali dish" is "the paneer one". The seller is naming a product they
// already sell, indirectly. Reported as an item, it billed a brand new
// product called "Cheese Wala Bhi" — which then PRINTS on the customer's
// bill.
//
// Containment cannot help: it looks for a catalog name inside the phrase,
// and here the phrase is a FRAGMENT of the catalog name, not the reverse.
// "cheese" is part of "cheese sandwich"; "cheese wala bhi" contains no
// product at all.
//
// So look the other way round: does any WORD of the phrase pick out a
// product? This needs no list of Hindi particles — "wala", "bhi", "woh"
// and "arey" match nothing in the price list and drop out on their own,
// while "cheese" matches exactly one thing. The words that mean something
// are the words the seller actually sells.
//
//   "woh cheese wala bhi"  ->  cheese  ->  Cheese Sandwich
//   "woh paneer wala"      ->  paneer  ->  two products -> ASK
//
// Two candidates is an ambiguity, not a coin toss — the seller gets
// buttons. A token under three letters is ignored: "ka" and "hi" are noise
// and would match half a menu by accident.
export function findProductByFragment(
  name: string,
  index: CatalogIndex,
): CatalogMatch | "ambiguous" | null {
  const tokens = [...new Set(
    name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length >= 3),
  )];
  if (tokens.length === 0) return null;

  const hits = new Map<string, CatalogProduct>();
  for (const token of tokens) {
    for (const { key, product } of index.allKeys) {
      if (key.split(/\s+/).includes(token)) hits.set(product.id, product);
    }
  }

  const found = [...hits.values()];
  if (found.length === 1) return { product: found[0]!, kind: "near" };
  if (found.length > 1) return "ambiguous";
  return null;
}

export function findProduct(
  name: string,
  index: CatalogIndex,
): CatalogMatch | "ambiguous" | null {
  const keys = candidateKeys(name);

  // Tier 1: exact.
  if (keys.some((k) => index.ambiguousKeys.has(k))) return "ambiguous";
  for (const key of keys) {
    const hit = index.byKey.get(key);
    if (hit) return { product: hit, kind: "exact" };
  }

  const typed = keys[0] ?? "";
  const typed0 = typed;

  // Tier 2: repeat-squeezed.
  for (const key of keys) {
    const squeezed = squeezeRepeats(key);
    if (index.ambiguousSqueezed.has(squeezed)) return "ambiguous";
    const hit = index.bySqueezed.get(squeezed);
    if (hit) return { product: hit, kind: "near" };
  }

  // Tier 2b: spacing. "rot i" -> "roti", "paneerroll" -> "paneer roll".
  // A stray or missing space is a normal phone typo, and edit distance
  // handles it badly: the space is one edit AND shifts everything after it.
  const despaced = squeezeSpaces(typed0);
  const spacingHits = index.allKeys.filter(({ key }) => squeezeSpaces(key) === despaced);
  const spacingProducts = new Set(spacingHits.map((h) => h.product.id));
  if (spacingProducts.size > 1) return "ambiguous";
  if (spacingHits.length > 0) return { product: spacingHits[0]!.product, kind: "near" };

  // Tier 3: edit distance. A winner must be strictly closer than every
  // other product — a tie is a genuine ambiguity, not a coin toss.
  const budget = distanceBudget(typed.length);
  if (budget === 0) return null;

  let best: { product: CatalogProduct; distance: number } | null = null;
  let runnerUpDistance = Number.POSITIVE_INFINITY;

  for (const { key, product } of index.allKeys) {
    const distance = editDistance(typed, key, budget);
    if (distance > budget) continue;

    if (!best || distance < best.distance) {
      if (best && best.product.id !== product.id) runnerUpDistance = best.distance;
      best = { product, distance };
    } else if (best.product.id !== product.id && distance < runnerUpDistance) {
      runnerUpDistance = distance;
    }
  }

  if (!best) return null;
  if (runnerUpDistance <= best.distance) return "ambiguous";
  return { product: best.product, kind: "near" };
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
  // Products the name could plausibly have meant. Populated for an
  // ambiguous match so the seller can be OFFERED the choice rather than
  // told to be more specific — being told "be more specific" about your
  // own price list is a dead end.
  candidates?: { id: string; name: string; price: number }[];
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
      // A stated price is the seller's explicit instruction, so it bills
      // even for an item that isn't in the price list at all. The lookup
      // here only attaches a product id when one is unambiguous.
      //
      // The NAME still goes through every tier, because the name is what
      // PRINTS on the customer's bill. "arey woh cheese wala bhi 1 60 ka"
      // billed a product called "Cheese Wala Bhi" — the price was right
      // and the document was embarrassing. A stated price settles the
      // money; it says nothing about what the thing is called.
      const direct = findProduct(item.name, index);
      const byName =
        direct ??
        findProductByContainment(item.name, index) ??
        findProductByFragment(item.name, index);
      const match = byName !== null && byName !== "ambiguous" ? byName.product : null;
      resolved.push({
        name: match ? match.name : item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        priceSource: "stated",
        productId: match?.id ?? null,
        evidence: item.evidence,
      });
      continue;
    }

    const found = findProduct(item.name, index);

    if (found === "ambiguous") {
      unresolved.push({
        name: item.name,
        reason: "ambiguous_in_catalog",
        candidates: findCandidates(item.name, index).map((p) => ({
          id: p.id,
          name: p.name,
          price: p.price,
        })),
      });
      continue;
    }
    if (found === null) {
      // Before giving up: is a product the seller DOES sell sitting inside
      // the name the model reported? "plate paneer tikka" is Paneer Tikka
      // wrapped in a container word.
      // Containment first ("plate paneer tikka" -> the product is INSIDE
      // the phrase), then fragment ("woh cheese wala" -> the phrase is a
      // fragment OF the product). Containment is the stronger signal, so
      // it is never overruled by the looser one.
      const contained = findProductByContainment(item.name, index);
      const inside = contained ?? findProductByFragment(item.name, index);
      if (inside !== null && inside !== "ambiguous") {
        resolved.push({
          name: inside.product.name,
          quantity: item.quantity,
          unitPrice: inside.product.price,
          priceSource: "catalog",
          productId: inside.product.id,
          evidence: item.evidence,
        });
        continue;
      }
      if (inside === "ambiguous") {
        unresolved.push({
          name: item.name,
          reason: "ambiguous_in_catalog",
          candidates: findCandidates(item.name, index).map((p) => ({
            id: p.id, name: p.name, price: p.price,
          })),
        });
        continue;
      }
      unresolved.push({ name: item.name, reason: "not_in_catalog" });
      continue;
    }

    resolved.push({
      // The CANONICAL name goes on the bill, not what was typed. A seller
      // who wrote "lasssi" sees "Lassi x 1" and can catch a wrong match
      // before confirming — which is what makes near-matching safe.
      name: found.product.name,
      quantity: item.quantity,
      unitPrice: found.product.price,
      priceSource: "catalog",
      productId: found.product.id,
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
      `I don't have a price for ${names}.\n\nAdd it:  /add ${notInCatalog[0]!.name} 100\n` +
        `Or state it in the order:  2 ${notInCatalog[0]!.name} 100`,
    );
  }
  if (ambiguous.length > 0) {
    const first = ambiguous[0]!;
    const options = (first.candidates ?? []).map((c) => `  ${c.name}`).join("\n");
    parts.push(
      `"${first.name}" could be more than one thing in your price list:\n${options}\n\n` +
        `Which one did you mean? I'll remember it.`,
    );
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
