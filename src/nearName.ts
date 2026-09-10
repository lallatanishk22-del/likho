// Shared near-name matching, used by two callers with different jobs:
//   catalog.ts        — match an order against the seller's price list
//   spellingSuggest.ts — spot a typo in the price list itself
//
// Extracted so both use ONE definition of "close enough". Two independent
// notions of that would drift apart, and the safety rules below are the
// whole reason near-matching is acceptable at all.

// Damerau-Levenshtein (optimal string alignment), with an early bail-out
// once every cell in a row exceeds the budget.
//
// Plain Levenshtein scores a transposition as TWO edits, so "smaosa" ->
// "samosa" cost the same as two unrelated letters being wrong. Transposing
// adjacent letters is one of the most common ways a person mistypes, so it
// is counted as the single slip it actually is.
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;

  const n = a.length;
  const m = b.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: m + 1 }, (_, i) => i);

  for (let i = 1; i <= n; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prev2[j - 2]! + 1);
      }
      row.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[m]!;
}

// How wrong a name is allowed to be, by its length. Tight on purpose:
// counting a transposition as one edit already covers most real typos, so
// the budget buys safety rather than recall.
//   <= 3   no slack — at three letters, one substitution is the difference
//          between two different products ("tea"/"sea")
//   4-7    one slip
//   >= 8   two, because a long name has more room for a genuine typo and
//          far less chance of colliding with something else
export function distanceBudget(length: number): number {
  if (length <= 3) return 0;
  if (length <= 7) return 1;
  return 2;
}

// Collapses runs of repeated letters: "lasssi" -> "lasi", "daal" -> "dal".
// Catches the most common typo class with no distance maths.
export function squeezeRepeats(name: string): string {
  return name.replace(/(.)\1+/g, "$1");
}

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

// Finds the single closest entry in `candidates`, or null. Returns null
// rather than guessing when nothing is close enough OR when two candidates
// are equally close — a tie is a genuine ambiguity, not a coin toss.
//
// An exact match returns null too: the caller is asking "is this a typo of
// something?", and a word that IS the thing is not a typo of it.
export function suggestFromList(name: string, candidates: string[]): string | null {
  const typed = normalizeName(name);
  if (typed.length === 0) return null;

  const normalized = candidates.map(normalizeName);
  if (normalized.includes(typed)) return null;

  // A doubled/missing repeated letter, e.g. "panner" vs "paneer" is caught
  // by distance anyway, but "lasssi" vs "lassi" is caught here first.
  const squeezed = squeezeRepeats(typed);
  for (let i = 0; i < normalized.length; i++) {
    if (squeezeRepeats(normalized[i]!) === squeezed) return candidates[i]!;
  }

  const budget = distanceBudget(typed.length);
  if (budget === 0) return null;

  let best: { value: string; distance: number } | null = null;
  let runnerUp = Number.POSITIVE_INFINITY;

  for (let i = 0; i < normalized.length; i++) {
    const distance = editDistance(typed, normalized[i]!, budget);
    if (distance > budget) continue;
    if (!best || distance < best.distance) {
      if (best) runnerUp = Math.min(runnerUp, best.distance);
      best = { value: candidates[i]!, distance };
    } else if (distance < runnerUp) {
      runnerUp = distance;
    }
  }

  if (!best) return null;
  if (runnerUp <= best.distance) return null;
  return best.value;
}
