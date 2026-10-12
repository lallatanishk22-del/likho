// Reads a bill REPLY back into items and a customer, for the evals.
//
// One place, tied to the live layout and pinned by test/billReading.test.ts:
// the Receipt layout once broke three evals at once (0/26, 0/10) because
// each matched the OLD text ("Chai × 2", "🧾 Ria — Bill") on its own. A
// layout change now fails a unit test instead of quietly blinding the evals.

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A receipt row: the item name, its quantity column, then its amount.
export function billHasItem(replyText: string, name: string, quantity: number): boolean {
  const row = new RegExp(`^\\s*${escapeRegex(name)}\\s+${quantity}\\s+₹`);
  return replyText.split("\n").some((line) => row.test(line.replace(/^<pre>/, "")));
}

// The receipt heading: "Bill #1042 · Ria Bhanushali". No name, no " · ".
export function billCustomer(replyText: string): string | null {
  const match = replyText.match(/Bill #\d+ · (.+)$/m);
  return match ? match[1]!.trim() : null;
}
