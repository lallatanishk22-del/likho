import { rest } from "./catalogStore.js";
import { normalizeName, suggestFromList } from "./nearName.js";

// Customer identity as durable data.
//
// Before this, the only trace of who a bill was for was a nullable string
// on the bill itself. That is a label, not a record: it cannot accumulate
// orders, it cannot answer "what does Ravi owe", and it made "open ravi
// bill" a guess. PRODUCT_DIRECTION is explicit that ZBill keeps its OWN
// customer records, built from normal usage — the seller never maintains
// a CRM, so every record here is created as a side effect of billing.
//
// The bill keeps customer_ref as the name-at-time-of-bill snapshot, for
// the same reason it snapshots the unit price: an old bill must never be
// rewritten by something that changed later.

export interface CustomerRow {
  id: string;
  business_id: string;
  // What the seller typed, preserved for display: "Ravi Jerath".
  name: string;
  // The matching key, so "Ravi", "ravi" and "RAVI." are one customer.
  normalized_name: string;
  created_at: string;
  updated_at: string;
}

// Must produce exactly what the migration's backfill produced, or a
// backfilled customer would never be found again.
export function normalizeCustomerName(name: string): string {
  return normalizeName(name);
}

// Raised when a name fits more than one customer. Carries the candidates,
// because the only useful reply is to name them: telling a seller "I don't
// have a bill for Ravi" when they have two Ravis is a lie that reads like
// data loss.
export class CustomerAmbiguousError extends Error {
  candidates: string[];
  constructor(typed: string, candidates: string[]) {
    super(`More than one customer matches "${typed}".`);
    this.name = "CustomerAmbiguousError";
    this.candidates = candidates;
  }
}

// Which stored customer the seller means by the name they said. Pure, so
// the rules can be tested without a database.
//
// Tiers, each tried across ALL customers before the next, so a perfect
// match never loses to a fuzzy one:
//   1. the same name          "ravi"  -> "Ravi"
//   2. a name they go by      "ravi"  -> "Ravi Jerath"
//   3. a typo                 "rvai"  -> "Ravi"
//
// Tier 2 is deliberately one-directional: a first name finds the fuller
// record, but "ravi jerath" never matches a bare "Ravi".
//
// Every tier past the first refuses to break a tie. Two customers sharing
// a first name, or a typo equally close to two names, resolves to NOBODY —
// the seller gets asked again. Money attached to the wrong customer is a
// financial error, not a cosmetic one.
export type CustomerMatch<T> =
  | { kind: "found"; customer: T }
  // More than one customer answers to the name. Distinct from "none" on
  // purpose — these need opposite replies.
  | { kind: "ambiguous"; candidates: T[] }
  | { kind: "none" };

export function resolveCustomer<T extends { name: string }>(
  customers: T[],
  wanted: string,
): CustomerMatch<T> {
  const target = normalizeCustomerName(wanted);
  if (target.length === 0) return { kind: "none" };

  const nameOf = (c: T) => normalizeCustomerName(c.name);

  const exact = customers.find((c) => nameOf(c) === target);
  if (exact) return { kind: "found", customer: exact };

  // A name they go by. Refuses when TWO customers answer to it: with both
  // Ravi Jerath and Ravi Kumar on the books, "ravi" is not an address, and
  // returning whichever sorted first would be a coin toss with money on it.
  const byFirstName = customers.filter((c) => nameOf(c).split(" ").includes(target));
  if (byFirstName.length === 1) return { kind: "found", customer: byFirstName[0]! };
  if (byFirstName.length > 1) return { kind: "ambiguous", candidates: byFirstName };

  // Tier 3 matches against full names AND first names, so "rvai" reaches
  // "Ravi Jerath" — a seller who types a name from memory misspells the
  // part they use, and that is usually the first name.
  //
  // A candidate that more than one customer answers to is dropped before
  // matching, not after: "ravi" must not resolve at all when both Ravi
  // Jerath and Ravi Kumar exist.
  const byCandidate = new Map<string, Set<T>>();
  for (const customer of customers) {
    const full = nameOf(customer);
    if (full.length === 0) continue;
    for (const candidate of new Set([full, full.split(" ")[0]!])) {
      const owners = byCandidate.get(candidate) ?? new Set<T>();
      owners.add(customer);
      byCandidate.set(candidate, owners);
    }
  }

  const unambiguous = [...byCandidate.entries()].filter(([, owners]) => owners.size === 1);
  const near = suggestFromList(target, unambiguous.map(([candidate]) => candidate));
  if (near) {
    const hit = unambiguous.find(([candidate]) => candidate === near)?.[1].values().next().value;
    if (hit) return { kind: "found", customer: hit };
  }

  // A typo that lands on a name two customers share: still ambiguous, not
  // absent. "rvai" with two Ravis must ask, exactly as "ravi" does.
  const shared = [...byCandidate.entries()].filter(([, owners]) => owners.size > 1);
  const nearShared = suggestFromList(target, shared.map(([candidate]) => candidate));
  if (nearShared) {
    const owners = shared.find(([candidate]) => candidate === nearShared)?.[1];
    if (owners) return { kind: "ambiguous", candidates: [...owners] };
  }

  return { kind: "none" };
}

// Convenience for callers that only care whether there is exactly one
// answer. Ambiguity collapses to null here, so anything that must TELL the
// seller about it uses resolveCustomer directly.
export function pickCustomer<T extends { name: string }>(
  customers: T[],
  wanted: string,
): T | null {
  const match = resolveCustomer(customers, wanted);
  return match.kind === "found" ? match.customer : null;
}

export async function listCustomers(businessId: string): Promise<CustomerRow[]> {
  return (await rest(
    `customers?business_id=eq.${businessId}&order=name.asc&select=*`,
  )) as CustomerRow[];
}

// Resolves a name the seller SAID to a customer they already have. Fuzzy,
// because this is a question ("open ravi bill") and the worst case is
// answering "I don't have a bill for Ravi".
export async function findCustomer(
  businessId: string,
  name: string,
): Promise<CustomerRow | null> {
  if (normalizeCustomerName(name).length === 0) return null;

  const match = resolveCustomer(await listCustomers(businessId), name);
  if (match.kind === "ambiguous") {
    throw new CustomerAmbiguousError(name, match.candidates.map((c) => c.name));
  }
  return match.kind === "found" ? match.customer : null;
}

// Resolves a name the seller wrote ON A BILL, creating the customer the
// first time they appear.
//
// Deliberately EXACT-match only, unlike findCustomer: this writes a
// financial record against whoever it returns. A near-match here would
// silently bill "Ravl" to Ravi. A duplicate customer row is a tidiness
// problem the seller can see and fix; money on the wrong customer is not.
export async function findOrCreateCustomer(
  businessId: string,
  name: string,
): Promise<CustomerRow | null> {
  const normalized = normalizeCustomerName(name);
  if (normalized.length === 0) return null;

  const existing = (await rest(
    `customers?business_id=eq.${businessId}&normalized_name=eq.${encodeURIComponent(normalized)}&limit=1&select=*`,
  )) as CustomerRow[];
  if (existing.length > 0) return existing[0]!;

  // The unique index on (business_id, normalized_name) is what actually
  // guarantees one Ravi. ignore-duplicates makes a webhook delivered
  // twice a no-op instead of an error, and the re-select below picks up
  // the row the other delivery won.
  const created = (await rest(
    "customers?on_conflict=business_id,normalized_name",
    {
      method: "POST",
      headers: { Prefer: "return=representation,resolution=ignore-duplicates" },
      body: JSON.stringify({ business_id: businessId, name: name.trim(), normalized_name: normalized }),
    },
  )) as CustomerRow[] | null;

  if (created && created.length > 0) return created[0]!;

  const raced = (await rest(
    `customers?business_id=eq.${businessId}&normalized_name=eq.${encodeURIComponent(normalized)}&limit=1&select=*`,
  )) as CustomerRow[];
  return raced[0] ?? null;
}

// --- History --------------------------------------------------------------
//
// What a seller means by "Ravi": show me this person. Not one bill — the
// whole relationship. Every bill they've had, newest first, with the date
// and time on each, plus what they still owe.
//
// Reading history NEVER mutates anything. It cannot create a customer,
// cannot open a draft, cannot change a total. That separation is what makes
// it safe to type a bare name and see what happens.

export interface CustomerBillRow {
  id: string;
  bill_no: number;
  total: string | number;
  amount_paid: string | number;
  payment_status: "pending" | "partial" | "paid";
  status: "draft" | "updated" | "finalized";
  created_at: string;
  finalized_at: string | null;
  customer_ref: string | null;
}

export interface CustomerHistory {
  customer: CustomerRow;
  // Every bill in the period, uncapped. The chat list is trimmed for
  // readability; a statement must show all of them.
  allBills: CustomerBillRow[];
  // Set when the seller asked about a period ("yesterday's bill of
  // tanishk"). Figures below then describe THAT window, not all time.
  periodLabel?: string | null;
  bills: CustomerBillRow[];
  // Totals are SUMMED from stored bill figures, never recalculated from
  // line items — the same rule the bill templates follow.
  billCount: number;
  lifetimeTotal: number;
  outstanding: number;
}

const HISTORY_PAGE = 10;

export async function loadCustomerHistory(
  businessId: string,
  customer: CustomerRow,
  range?: { label: string; from: Date; to: Date } | null,
  limit = HISTORY_PAGE,
): Promise<CustomerHistory> {
  // Bills are matched by customer_id where one is linked, and fall back to
  // the stored name for bills made before customers existed — otherwise a
  // seller's older history would silently vanish.
  const byId = (await rest(
    `bill_sessions?business_id=eq.${businessId}&customer_id=eq.${customer.id}` +
      `&order=created_at.desc&select=*`,
  )) as CustomerBillRow[];

  const byName = (await rest(
    `bill_sessions?business_id=eq.${businessId}&customer_id=is.null` +
      `&customer_ref=ilike.${encodeURIComponent(customer.name)}` +
      `&order=created_at.desc&select=*`,
  )) as CustomerBillRow[];

  const seen = new Set(byId.map((b) => b.id));
  const all = [...byId, ...byName.filter((b) => !seen.has(b.id))].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );

  // A period narrows BOTH the list and the figures, so "yesterday's bills"
  // reports yesterday's money rather than showing yesterday's rows under an
  // all-time total — which would be an accounting error, not a display one.
  const inRange = range
    ? all.filter((b) => {
        const at = Date.parse(b.finalized_at ?? b.created_at);
        return at >= range.from.getTime() && at < range.to.getTime();
      })
    : all;

  const windowed = inRange;

  // Figures count CONFIRMED bills only. A draft is not yet a transaction,
  // and counting it would overstate what the customer owes.
  const confirmed = inRange.filter((b) => b.status === "finalized");
  const lifetimeTotal = confirmed.reduce((sum, b) => sum + Number(b.total), 0);
  const paid = confirmed.reduce((sum, b) => sum + Number(b.amount_paid), 0);

  return {
    customer,
    periodLabel: range?.label ?? null,
    allBills: inRange,
    bills: windowed.slice(0, limit),
    billCount: confirmed.length,
    lifetimeTotal: Math.round(lifetimeTotal * 100) / 100,
    outstanding: Math.round((lifetimeTotal - paid) * 100) / 100,
  };
}

// Customers with something outstanding, most owed first — "who hasn't paid".
export async function listOutstanding(
  businessId: string,
): Promise<{ name: string; outstanding: number; billCount: number }[]> {
  const rows = (await rest(
    `bill_sessions?business_id=eq.${businessId}&status=eq.finalized` +
      `&payment_status=in.(pending,partial)&order=created_at.desc&select=*`,
  )) as CustomerBillRow[];

  const byName = new Map<string, { name: string; outstanding: number; billCount: number }>();
  for (const bill of rows) {
    const name = bill.customer_ref?.trim();
    if (!name) continue;
    const key = normalizeCustomerName(name);
    const due = Number(bill.total) - Number(bill.amount_paid);
    if (due <= 0) continue;
    const entry = byName.get(key) ?? { name, outstanding: 0, billCount: 0 };
    entry.outstanding = Math.round((entry.outstanding + due) * 100) / 100;
    entry.billCount += 1;
    byName.set(key, entry);
  }

  return [...byName.values()].sort((a, b) => b.outstanding - a.outstanding);
}

// --- Finding a customer named anywhere in a message ----------------------
//
// Two attempts at this failed the same way. Both tried to work out which
// words were FILLER and treat the remainder as a name:
//
//   "dude get me bill of ria"          -> needed "dude", "get", "of"
//   "bring me yesterday bill of tanishk" -> needed "yesterday"
//   "can you get me bills total of ravi" -> needed "total"
//
// Each fix added words to a list and waited for the next word nobody
// thought of. English has no end of them, so the list can never be
// finished — the approach was wrong, not incomplete.
//
// This inverts it. The seller's customer list is GROUND TRUTH and it is
// small, so instead of asking "which words are filler?" it asks "does any
// word here name someone I know?" No vocabulary of English is required,
// and a phrasing nobody has imagined yet works the first time.
export async function findCustomerInMessage(
  businessId: string,
  text: string,
): Promise<CustomerRow | "ambiguous" | null> {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\s'’]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return null;

  const customers = await listCustomers(businessId);
  if (customers.length === 0) return null;

  // Windows of 3, then 2, then 1 word: a full name must beat the first name
  // inside it, so "ria bhanushali" is never resolved as whoever "ria" is.
  const found = new Map<string, CustomerRow>();
  for (const size of [3, 2, 1]) {
    for (let i = 0; i + size <= words.length; i++) {
      const phrase = words.slice(i, i + size).join(" ");
      const match = resolveCustomer(customers, phrase);
      if (match.kind === "found") found.set(match.customer.id, match.customer);
    }
    // Stop at the longest window that matched anything: a 2-word hit and
    // the 1-word hit inside it are the same person, not two candidates.
    if (found.size > 0) break;
  }

  if (found.size === 0) return null;
  // Two genuinely different people named in one message is a question this
  // cannot answer, so it asks rather than picking.
  if (found.size > 1) return "ambiguous";
  return [...found.values()][0]!;
}

// Settles every unpaid confirmed bill for one customer.
//
// "tanishk cleared all his dues" is a real and common thing for a seller to
// say, and making them mark six bills one number at a time is how a tool
// gets abandoned. Drafts are deliberately untouched: a draft is not yet a
// transaction, so it cannot be paid.
//
// Each bill is set to ITS OWN total rather than dividing a lump sum, so the
// amount recorded against every bill stays exactly what that bill charged.
export async function settleAllForCustomer(
  businessId: string,
  customer: CustomerRow,
): Promise<{ billNos: number[]; amount: number }> {
  const history = await loadCustomerHistory(businessId, customer, null, 1000);
  const unpaid = history.allBills.filter(
    (b) => b.status === "finalized" && Number(b.amount_paid) < Number(b.total),
  );
  if (unpaid.length === 0) return { billNos: [], amount: 0 };

  let amount = 0;
  for (const bill of unpaid) {
    amount += Number(bill.total) - Number(bill.amount_paid);
    await rest(`bill_sessions?id=eq.${bill.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        amount_paid: Number(bill.total),
        payment_status: "paid",
        updated_at: new Date().toISOString(),
      }),
    });
  }

  return {
    billNos: unpaid.map((b) => b.bill_no).sort((a, b) => a - b),
    amount: Math.round(amount * 100) / 100,
  };
}

// What settling WOULD do, without doing it — so the seller sees the amount
// before confirming.
export async function pendingSettlement(
  businessId: string,
  customer: CustomerRow,
): Promise<{ billNos: number[]; amount: number }> {
  const history = await loadCustomerHistory(businessId, customer, null, 1000);
  const unpaid = history.allBills.filter(
    (b) => b.status === "finalized" && Number(b.amount_paid) < Number(b.total),
  );
  return {
    billNos: unpaid.map((b) => b.bill_no).sort((a, b) => a - b),
    amount:
      Math.round(unpaid.reduce((s, b) => s + Number(b.total) - Number(b.amount_paid), 0) * 100) / 100,
  };
}

// --- What the conversation is about --------------------------------------
//
// A person does not repeat the name in every sentence. After "tanishk",
// "okay how much is the due amt" plainly still means Tanishk — but each
// message was read in isolation, so it was answered shop-wide.
//
// Only the SUBJECT is remembered, never a transcript. And it is used only
// to ANSWER: anything that changes money still needs the name said out
// loud or a button tapped, so a stale subject can never cause a wrong write.

export async function rememberCustomer(businessId: string, customerId: string): Promise<void> {
  await rest("chat_context?on_conflict=business_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      business_id: businessId,
      last_customer_id: customerId,
      updated_at: new Date().toISOString(),
    }),
  });
}

// The customer last discussed, if it was recent. An hour old is still the
// same conversation; yesterday's is not, and answering about them would be
// worse than asking.
const CONTEXT_TTL_MS = 60 * 60 * 1000;

export async function recallCustomer(businessId: string): Promise<CustomerRow | null> {
  const rows = (await rest(
    `chat_context?business_id=eq.${businessId}&select=last_customer_id,updated_at`,
  )) as { last_customer_id: string | null; updated_at: string }[];

  const row = rows[0];
  if (!row?.last_customer_id) return null;
  if (Date.now() - Date.parse(row.updated_at) > CONTEXT_TTL_MS) return null;

  const customers = await listCustomers(businessId);
  return customers.find((c) => c.id === row.last_customer_id) ?? null;
}
