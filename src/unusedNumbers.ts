// Every number the seller typed must end up somewhere on the bill.
//
// Reported: "home delivery 50" was silently dropped. The charge word had
// to be the whole phrase, so the line fell through to the model, the model
// produced no item for it, and ₹50 left the bill without a word. The
// seller read a complete-looking bill for ₹920 believing it was ₹970.
//
// That is the worst failure mode a billing product has — not a wrong
// answer, which gets argued about and corrected, but a quiet one. So this
// is a last line of defence UNDER the parsers: whatever they understood,
// any number left over is said out loud.
//
// It never refuses and never changes a total. Refusing would punish the
// seller for the parser's gap; a note lets them see it and decide.

export interface BillNumberUse {
  quantities: number[];
  unitPrices: number[];
  chargeAmounts: number[];
  discountPercent: number | null;
}

// Numbers written as digits, ignoring percentages (a discount is handled
// separately) and anything attached to a "#" (a bill reference, not money).
function numbersIn(text: string): number[] {
  const found: number[] = [];
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) {
    const before = text.slice(Math.max(0, m.index! - 1), m.index!);
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 2);
    if (before === "#") continue;
    if (/^\s*%/.test(after)) continue;
    found.push(Number(m[0]));
  }
  return found;
}

// Returns the numbers present in the message that nothing on the bill
// accounts for. Order preserved, duplicates collapsed.
export function unusedNumbers(message: string, use: BillNumberUse): number[] {
  const accounted = new Set<number>([
    ...use.quantities,
    ...use.unitPrices,
    ...use.chargeAmounts,
  ]);
  if (use.discountPercent !== null) accounted.add(use.discountPercent);

  // A line total the seller may have written out themselves ("2 chai 30")
  // is not a stray number — it is arithmetic they already did.
  for (const q of use.quantities) {
    for (const p of use.unitPrices) accounted.add(q * p);
  }

  const seen = new Set<number>();
  const left: number[] = [];
  for (const n of numbersIn(message)) {
    if (accounted.has(n) || seen.has(n)) continue;
    seen.add(n);
    left.push(n);
  }
  return left;
}
