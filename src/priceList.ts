// Parsing a seller's price list, in whatever shape they actually type it.
//
// The first version accepted exactly one shape — "<name> <price>", one per
// line — and rejected "/add 150 panner 20 lassi" outright. That is a
// perfectly normal way to write a price list, and being told "Couldn't
// read" while your items silently fail to save is the worst possible
// outcome for the one step that everything else depends on.
//
// Pure and deterministic: no model. Setting prices is the seller stating
// facts about their own business, so there is nothing to infer.

export interface PriceEntry {
  name: string;
  price: number;
}

export interface PriceListParse {
  entries: PriceEntry[];
  // Fragments that could not be read as a name/price pair, returned so the
  // seller is told exactly which part failed instead of the whole message.
  unreadable: string[];
}

// "120", "₹120", "rs120", "rs.120", "120.50" — but never "7up" or "500ml",
// which are parts of a product name.
const PRICE_TOKEN = /^(?:₹|rs\.?)?(\d+(?:\.\d{1,2})?)$/i;

function priceOf(token: string): number | null {
  const m = token.match(PRICE_TOKEN);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

type Run = { type: "words"; value: string } | { type: "price"; value: number };

// Collapses a token stream into alternating runs of words and prices, so
// "paneer roll 120" is [words("paneer roll"), price(120)] regardless of how
// many words the product name has.
function toRuns(tokens: string[]): Run[] {
  const runs: Run[] = [];
  for (const token of tokens) {
    const price = priceOf(token);
    if (price !== null) {
      runs.push({ type: "price", value: price });
      continue;
    }
    const last = runs[runs.length - 1];
    if (last && last.type === "words") {
      last.value += ` ${token}`;
    } else {
      runs.push({ type: "words", value: token });
    }
  }
  return runs;
}

// One line may hold several items. Which side the price sits on is decided
// ONCE per line, from whichever comes first, and then applied consistently
// across the whole line — so "150 panner 20 lassi" and "panner 150 lassi 20"
// both read correctly, and a line can never be interpreted half one way and
// half the other.
function parseLine(line: string): PriceListParse {
  const tokens = line.split(/\s+/).filter((t) => t.length > 0);
  const runs = toRuns(tokens);

  if (runs.length === 0) return { entries: [], unreadable: [] };
  if (runs.length === 1) return { entries: [], unreadable: [line] };

  const priceFirst = runs[0]!.type === "price";
  const entries: PriceEntry[] = [];
  const unreadable: string[] = [];

  for (let i = 0; i + 1 < runs.length; i += 2) {
    const first = runs[i]!;
    const second = runs[i + 1]!;
    const nameRun = priceFirst ? second : first;
    const priceRun = priceFirst ? first : second;

    if (nameRun.type !== "words" || priceRun.type !== "price") {
      unreadable.push(`${describe(first)} ${describe(second)}`.trim());
      continue;
    }
    const name = nameRun.value.replace(/[,;]+$/, "").trim();
    if (name.length === 0) {
      unreadable.push(String(priceRun.value));
      continue;
    }
    entries.push({ name, price: priceRun.value });
  }

  // An odd trailing run is a name with no price, or a price with no name.
  if (runs.length % 2 === 1) {
    unreadable.push(describe(runs[runs.length - 1]!));
  }

  return { entries, unreadable };
}

function describe(run: Run): string {
  return run.type === "words" ? run.value : String(run.value);
}

// Splits on newlines AND commas, since a seller writes both:
//   paneer 220
//   lassi 80
// and
//   paneer 220, lassi 80
export function parsePriceList(text: string): PriceListParse {
  const lines = text
    .split(/[\r\n,;]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const entries: PriceEntry[] = [];
  const unreadable: string[] = [];
  for (const line of lines) {
    const parsed = parseLine(line);
    entries.push(...parsed.entries);
    unreadable.push(...parsed.unreadable);
  }

  // Last one wins if the same item is listed twice in a single message —
  // the seller correcting themselves mid-list.
  const deduped = new Map<string, PriceEntry>();
  for (const entry of entries) deduped.set(entry.name.toLowerCase(), entry);

  return { entries: [...deduped.values()], unreadable };
}

// Whether a message is UNAMBIGUOUSLY a price list rather than an order.
//
// Used only where the two could otherwise be confused: a seller with an
// empty price list who types "paneer 220" is answering the message that
// asked for their rates, not ordering one paneer. Getting this wrong in
// either direction is a financial error, so the test is deliberately
// stricter than parsePriceList itself:
//
//   paneer 220              -> rates (name first, price last)
//   paneer 220, lassi 80    -> rates
//   2 paneer                -> ORDER. Price-first is legal in an explicit
//                              /add, but here it would save paneer at ₹2.
//   Ravi 2 paneer 220       -> ORDER. Two entries on one line.
export function readsAsPriceList(text: string): boolean {
  const lines = text
    .split(/[\r\n,;]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return false;

  return lines.every((line) => {
    const tokens = line.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length < 2) return false;
    if (priceOf(tokens[0]!) !== null) return false;
    if (priceOf(tokens[tokens.length - 1]!) === null) return false;

    const { entries, unreadable } = parseLine(line);
    return entries.length === 1 && unreadable.length === 0;
  });
}
