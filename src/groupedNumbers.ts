// "1,00,000" is one number. Read raw, the commas split it into 1, 00 and
// 000 — a seller's 1,00,000 gold was billed as Gold × 1 at ₹100. Indian
// (1,00,000 / 10,00,000) and Western (100,000 / 1,000,000) grouping are
// both joined here, before any parser sees the text. A comma followed by
// fewer than three digits ("2,3 samosa") is a list, and is left alone.
const GROUPED = /\b\d{1,3}(?:(?:,\d{3})+|(?:,\d{2})*,\d{3})(?![\d,])/g;

export function joinGroupedNumbers(text: string): string {
  return text.replace(GROUPED, (m) => m.replace(/,/g, ""));
}
