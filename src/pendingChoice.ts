import { rest } from "./catalogStore.js";
import { editDistance, distanceBudget, normalizeName } from "./nearName.js";
import { looksLikeOrderShape } from "./intent.js";

// Answering the question Likho just asked, in words.
//
// Every question so far could only be answered by TAPPING, or by one
// hardcoded phrasing. Asked "cake or caku?", a seller who typed "cake",
// "drop caku", "the first one" or "caku hata do" got none of them — only
// "keep only cake" worked, because that exact wording had a regex behind
// it. Two of ten natural answers.
//
// This is the same mistake as guessing which words are filler in a customer
// question, and it has the same fix: the OPTIONS ARE KNOWN. Match the reply
// against what was actually offered, and no phrasing has to be guessed.

export interface ChoiceOption {
  // What the button says, e.g. 'Keep "cake"'.
  label: string;
  // The action to run if this one is chosen.
  action: string;
  // The part that identifies it — the product or customer name.
  value: string;
}

// Long enough to answer a question, short enough that a reply hours later
// is never attached to a question the seller has forgotten.
const CHOICE_TTL_MS = 15 * 60 * 1000;

export async function setPendingChoice(
  businessId: string,
  options: ChoiceOption[],
): Promise<void> {
  if (options.length === 0) return;
  await rest("pending_choices?on_conflict=business_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      business_id: businessId,
      options,
      created_at: new Date().toISOString(),
    }),
  });
}

export async function clearPendingChoice(businessId: string): Promise<void> {
  await rest(`pending_choices?business_id=eq.${businessId}`, { method: "DELETE" });
}

async function loadPendingChoice(businessId: string): Promise<ChoiceOption[] | null> {
  const rows = (await rest(
    `pending_choices?business_id=eq.${businessId}&select=options,created_at`,
  )) as { options: ChoiceOption[]; created_at: string }[];

  const row = rows[0];
  if (!row) return null;
  if (Date.now() - Date.parse(row.created_at) > CHOICE_TTL_MS) return null;
  return row.options;
}

// Ordinals only. "one"/"two"/"three" were included at first and broke
// immediately: "the second one" contains "one" and selected the FIRST
// option. A bare digit is fine because it cannot appear inside another
// ordinal.
const POSITIONS: [RegExp, number][] = [
  [/\b(first|1st|pehla|pehli|1)\b/i, 0],
  [/\b(second|2nd|dusra|dusri|doosra|2)\b/i, 1],
  [/\b(third|3rd|teesra|3)\b/i, 2],
];

// Words that REJECT the option they sit beside rather than choosing it.
// "drop caku" and "keep caku" name the same option and mean the opposite.
const REJECTING = /\b(drop|remove|delete|hata|nikal|no|not|nahi|nahin|cancel)\b/i;

export type ChoiceMatch =
  | { kind: "chosen"; option: ChoiceOption }
  | { kind: "none" };

// Does this phrase name this option? Returned as a tier so an EXACT name
// can beat a near one — without that, "cake" matched both "cake" and
// "caku" (one letter apart), counted as two hits, and was refused.
function nameTier(words: string[], value: string): 0 | 1 | null {
  const target = normalizeName(value);
  if (target.length === 0) return null;
  const size = target.split(/\s+/).length;

  let near = false;
  for (let i = 0; i + size <= words.length; i++) {
    const phrase = words.slice(i, i + size).join(" ");
    if (phrase === target) return 0;
    const budget = distanceBudget(phrase.length);
    if (budget > 0 && editDistance(phrase, target, budget) <= budget) near = true;
  }
  return near ? 1 : null;
}

// Which option does this message identify? Pure, so it is testable without
// a database.
export function matchChoice(text: string, options: ChoiceOption[]): ChoiceMatch {
  if (options.length === 0) return { kind: "none" };

  const said = normalizeName(text);
  if (said.length === 0) return { kind: "none" };

  // An answer to "which name?" carries no quantity. The only numbers that
  // belong here are positional — "1", "2" — and those stand alone.
  //
  // looksLikeOrderShape alone was not enough: it looks for a quantity
  // BEFORE a product, so "cake 2" slipped through and would have dropped a
  // product instead of billing two cakes. Falling through to the order
  // parser is the safe side of that call.
  const bare = text.trim();
  const isPositionalDigit = /^[1-9]$/.test(bare);
  if (!isPositionalDigit && (/\d/.test(bare) || looksLikeOrderShape(text))) {
    return { kind: "none" };
  }

  // Positional: "the first one", "2".
  for (const [pattern, index] of POSITIONS) {
    if (pattern.test(said) && options[index]) {
      return { kind: "chosen", option: options[index]! };
    }
  }

  const words = said.split(/\s+/).filter(Boolean);
  const scored = options
    .map((option, index) => ({ option, index, tier: nameTier(words, option.value) }))
    .filter((x): x is { option: ChoiceOption; index: number; tier: 0 | 1 } => x.tier !== null);

  // An exact name wins outright; near matches are only consulted when no
  // option was named exactly.
  const exact = scored.filter((x) => x.tier === 0);
  const hits = exact.length > 0 ? exact : scored;
  if (hits.length !== 1) return { kind: "none" };

  const hit = hits[0]!;
  // "drop caku" names caku but means keep the OTHER one. With exactly two
  // options that is unambiguous; with more it is not, so it refuses.
  if (REJECTING.test(said)) {
    if (options.length !== 2) return { kind: "none" };
    return { kind: "chosen", option: options[hit.index === 0 ? 1 : 0]! };
  }

  return { kind: "chosen", option: hit.option };
}

// Reads the stored question and decides whether this message answers it.
// Returns null when it does not, so the message falls through to normal
// routing and nothing is ever blocked behind a question.
export async function resolvePendingChoice(
  businessId: string,
  text: string,
): Promise<ChoiceOption | null> {
  const options = await loadPendingChoice(businessId);
  if (!options) return null;

  const match = matchChoice(text, options);
  if (match.kind !== "chosen") return null;

  await clearPendingChoice(businessId);
  return match.option;
}
