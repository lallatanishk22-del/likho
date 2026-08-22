// Shared by run.ts and runRouted.ts. The model is graded on whether it got
// the item right, not on exact string equality — "panner tikka" (a typo the
// model faithfully preserved) should count as a match for "paneer tikka",
// the same way "chicken biryani" already matched via substring. Plain
// substring containment (the old check) doesn't catch typos that aren't a
// prefix/suffix relationship, so a small edit-distance tolerance is added.

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z ]/g, "").trim();
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j - 1]!, dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  return dp[a.length]![b.length]!;
}

// Exact match, substring containment (e.g. "paneer" vs "paneer tikka"), or a
// small relative edit distance (typo tolerance, e.g. "panner" vs "paneer").
export function namesMatch(actual: string, expected: string): boolean {
  const a = normalizeName(actual);
  const e = normalizeName(expected);
  if (a === e || a.includes(e) || e.includes(a)) return true;

  const maxLen = Math.max(a.length, e.length);
  if (maxLen === 0) return true;
  return levenshtein(a, e) / maxLen <= 0.25;
}

export interface MatchableItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

// Order-INDEPENDENT comparison. Nothing in the extraction contract
// (orderExtractionPrompt.ts) requires items to come back in the order they
// appeared in the message, and the calculator sums line totals regardless of
// order — so grading positionally (item[0] vs item[0], item[1] vs item[1])
// would fail a parser that got every item exactly right but listed them in
// a different order. Each expected item is matched against any one
// still-unclaimed actual item (by name + exact quantity + exact price); a
// claimed actual item can't be reused for a second expected item.
export function itemsMatch(actual: MatchableItem[], expected: MatchableItem[]): string | null {
  if (actual.length !== expected.length) {
    return `expected ${expected.length} item(s), got ${actual.length}`;
  }

  const remaining = [...actual];
  for (const exp of expected) {
    const idx = remaining.findIndex(
      (act) => namesMatch(act.name, exp.name) && act.quantity === exp.quantity && act.unitPrice === exp.unitPrice,
    );
    if (idx === -1) {
      const closestByName = remaining.find((act) => namesMatch(act.name, exp.name));
      if (closestByName) {
        return `item "${exp.name}": expected qty ${exp.quantity} @ ₹${exp.unitPrice}, got qty ${closestByName.quantity} @ ₹${closestByName.unitPrice}`;
      }
      return `no item found matching expected "${exp.name}" (qty ${exp.quantity}, ₹${exp.unitPrice})`;
    }
    remaining.splice(idx, 1);
  }
  return null;
}
