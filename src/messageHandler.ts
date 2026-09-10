import { routeParseOrder } from "./router.js";
import { calculateBill } from "./calculator.js";
import { formatBill } from "./formatter.js";
import { getOrCreateBusinessForChannel, loadCatalog, upsertProduct, deactivateProduct, renameProduct } from "./catalogStore.js";
import { suggestSpelling, findNearDuplicate } from "./spellingSuggest.js";
import {
  createBillSession,
  getCurrentDraft,
  finalizeBill,
  getTodaysSales,
  addItemToBill,
  removeItemFromBill,
  getBillByNo,
  recordPayment,
  setItemQuantity,
  getOpenBills,
  getSales,
  type StoredBill,
} from "./billStore.js";
import { buildCatalogIndex, findProduct } from "./catalog.js";
import { classifyIntent } from "./intent.js";
import { parsePriceList } from "./priceList.js";
import { formatBusinessDateTime, parseDateRange } from "./businessDay.js";

// Platform-independent command routing. Telegram polling (telegramBot.ts)
// and the HTTP API used by n8n (apiServer.ts) both call handleIncoming(),
// so every channel gets identical behaviour and the logic cannot drift
// between them. Nothing here knows what Telegram is.

export type Platform = "telegram" | "whatsapp";

// A reply is text PLUS the actions a seller can take on it. The core names
// the actions; each channel adapter decides how to show them (Telegram
// inline buttons today, something else on WhatsApp later). Nothing here
// knows what a button is.
export interface ReplyAction {
  label: string;
  // Opaque to the channel: "confirm:1042". Routed back through
  // handleAction() so a button press and a typed message run identical code.
  action: string;
}

export interface Reply {
  text: string;
  actions?: ReplyAction[];
}

export interface IncomingMessage {
  platform: Platform;
  // Stable per-seller identity on that platform (Telegram chat id today).
  platformUserId: string;
  displayName: string;
  text: string;
  messageId?: string | null;
  // Text of a message being replied to — how an order written by someone
  // else is handed to Likho without retyping it.
  repliedText?: string | null;
  repliedMessageId?: string | null;
  // Text of a message the seller FORWARDED to Likho. Treated as the order
  // itself: forwarding exists precisely so nothing has to be retyped.
  forwardedText?: string | null;
  // Optional hook so a slow channel can show a "working on it" signal.
  onSlowWork?: () => Promise<void>;
}

// Renders a bill from STORED state, so the seller always sees exactly what
// is persisted rather than a freshly recomputed guess.
function formatRupees(amount: number): string {
  const n = Number(amount);
  const hasPaise = Math.round(n * 100) % 100 !== 0;
  return `\u20b9${n.toLocaleString("en-IN", {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

function titleCase(name: string): string {
  return name.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// The bill as an ARTIFACT, not a paragraph: aligned columns, a real
// transaction number, and an explicit payment state. Rendered from STORED
// state so the seller always sees exactly what is persisted.
function renderStoredBill(stored: StoredBill): string {
  const { session, items } = stored;

  const rows = items.map((item) => ({
    left: `${titleCase(item.name_snapshot)} \u00d7 ${item.quantity}`,
    right: formatRupees(Number(item.line_total)),
  }));

  const summary: { left: string; right: string }[] = [];
  if (Number(session.discount_percent) > 0) {
    summary.push({ left: "Subtotal", right: formatRupees(Number(session.subtotal)) });
    summary.push({
      left: `Discount (${Number(session.discount_percent)}%)`,
      right: `\u2212${formatRupees(Number(session.discount_amount))}`,
    });
  }
  summary.push({ left: "TOTAL", right: formatRupees(Number(session.total)) });

  const width = Math.max(...[...rows, ...summary].map((r) => r.left.length)) + 3;
  const line = (r: { left: string; right: string }) => r.left.padEnd(width) + r.right;

  const who = session.customer_ref ? `${titleCase(session.customer_ref)} \u2014 ` : "";
  const paid =
    session.payment_status === "paid"
      ? "Paid"
      : session.payment_status === "partial"
        ? `Partly paid \u2014 ${formatRupees(Number(session.amount_paid))} of ${formatRupees(Number(session.total))}`
        : "Pending";

  // Every bill carries its own date and time, in the business's timezone.
  // A bill without one is a message, not a record — and once several exist
  // in a chat, "which day was this?" has no answer without it.
  const stamp = formatBusinessDateTime(new Date(session.finalized_at ?? session.created_at));

  return [
    `\u{1f9fe} ${who}Bill #${session.bill_no}`,
    stamp,
    "",
    ...rows.map(line),
    "\u2500".repeat(width + 8),
    ...summary.map(line),
    "",
    `Payment: ${paid}`,
  ].join("\n");
}

// Actions offered alongside a bill. A draft's primary action is Confirm;
// once confirmed the useful actions are payment and PDF.
function billActions(stored: StoredBill): ReplyAction[] {
  const no = stored.session.bill_no;
  const actions: ReplyAction[] = [];
  if (stored.session.status !== "finalized") {
    actions.push({ label: "\u2705 Confirm", action: `confirm:${no}` });
  }
  if (stored.session.payment_status !== "paid") {
    actions.push({ label: "\u{1f4b0} Mark Paid", action: `paid:${no}` });
  }
  actions.push({ label: "\u{1f4c4} PDF", action: `pdf:${no}` });
  return actions;
}

const HELP = `Likho \u2014 send me the order, I'll make the bill.

Just type it. No commands needed:
  Ravi 2 paneer 1 lassi

Or forward the customer's message straight to me.

Set your rates first, one per line:
  /add paneer 220
  lassi 80
  samosa 20

Then talk to me normally:
  actually paneer was 3    fix the open bill
  add 2 samosa             add to it
  remove lassi             take it off
  show #1042               see any bill
  #1042 paid               record payment
  sales                    today's total

Buttons on each bill do the same thing.`;

// Saves prices in whatever shape the seller typed them — see priceList.ts.
// Partial success is deliberate: an unreadable fragment must never discard
// the items that WERE understood.
async function handleAdd(businessId: string, args: string): Promise<Reply> {
  const { entries, unreadable } = parsePriceList(args);

  if (entries.length === 0 && unreadable.length === 0) {
    return {
      text:
        "Tell me your rates. Any of these work:\n" +
        "  /add paneer 220\n" +
        "  /add 220 paneer\n" +
        "  /add paneer 220, lassi 80\n\n" +
        "Or one per line.",
    };
  }

  // Read the price list BEFORE saving, so a near-duplicate can be spotted
  // against what was already there.
  const before = await loadCatalog(businessId);

  const saved: string[] = [];
  for (const entry of entries) {
    await upsertProduct(businessId, entry.name, entry.price);
    saved.push(`${entry.name} \u2014 ${formatRupees(entry.price)}`);
  }

  const duplicates = entries
    .map((e) => findNearDuplicate(e.name, before.products))
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Flag likely misspellings, but SAVE WHAT WAS TYPED. The name goes on
  // every bill the customer sees, so a typo here is permanent and worth
  // catching — but it is the seller's menu, and a shop genuinely called
  // "Panner Corner" must not be overruled by a spellchecker.
  const allSuggestions = entries
    .map((e) => suggestSpelling(e.name))
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const parts: string[] = [];
  if (saved.length > 0) {
    parts.push(`Saved ${saved.length} item(s):\n${saved.map((s) => `  ${s}`).join("\n")}`);
  }
  const actions: ReplyAction[] = [];

  // A duplicate in the seller's OWN list matters more than a dictionary
  // suggestion, and the two would otherwise both fire on the same item.
  const duplicateNames = new Set(duplicates.map((d) => d.added.toLowerCase()));

  for (const d of duplicates) {
    const action = encodeMerge(d.existing);
    parts.push(
      `You already have "${d.existing}" at ${formatRupees(d.existingPrice)}, ` +
        `which looks like the same thing as "${d.added}".\n\n` +
        `If they are different items, keep both. If not, two names means ` +
        `your sales get split across them, and a misspelled order ` +
        `("${d.added.slice(0, 3)}...") can't be priced \u2014 I won't guess ` +
        `which one you meant.` +
        (action
          ? `\nTap to drop "${d.existing}" and keep "${d.added}" at ${formatRupees(entries.find((e) => e.name === d.added)!.price)}.`
          : `\n\nTo drop the old one:  /remove ${d.existing}`),
    );
    if (action) {
      actions.push({ label: `\u{1f500} Keep only "${d.added}"`, action });
    }
  }

  const suggestions = allSuggestions.filter((x) => !duplicateNames.has(x.typed.toLowerCase()));

  if (suggestions.length > 0) {
    const lines = suggestions.map((x) => `  "${x.typed}" \u2192 "${x.suggested}"?`);
    const fixable = suggestions.filter((x) => encodeFix(x.typed, x.suggested) !== null);

    parts.push(
      `${suggestions.length === 1 ? "One name looks" : "Some names look"} like a spelling slip:\n` +
        `${lines.join("\n")}\n\n` +
        `This is what prints on the customer's bill.` +
        (fixable.length === suggestions.length
          ? `\nTap to fix, or ignore it if the spelling is deliberate.`
          : `\n\nTo change one:  rename ${suggestions[0]!.typed} to ${suggestions[0]!.suggested}`),
    );

    for (const x of fixable) {
      actions.push({
        label: `\u270f\ufe0f ${x.typed} \u2192 ${x.suggested}`,
        action: encodeFix(x.typed, x.suggested)!,
      });
    }
  }
  if (unreadable.length > 0) {
    parts.push(
      `I couldn't find a price for:\n${unreadable.map((f) => `  ${f}`).join("\n")}\n\n` +
        `Send it as "${unreadable[0]} 100" and I'll save it.`,
    );
  }
  return { text: parts.join("\n\n"), actions: actions.length > 0 ? actions : undefined };
}

// Renaming keeps the product's id, so bills that already used it stay
// linked and their price snapshots are untouched. Only the name that
// prints on FUTURE bills changes.
async function handleRename(businessId: string, args: string): Promise<Reply> {
  const match = args.match(/^(.+?)\s+(?:to|as|->|\u2192)\s+(.+)$/i);
  if (!match) {
    return { text: 'Use: rename panner to paneer' };
  }
  const from = match[1]!.trim();
  const to = match[2]!.trim();
  if (from.length === 0 || to.length === 0) {
    return { text: 'Use: rename panner to paneer' };
  }

  const result = await renameProduct(businessId, from, to);
  if (result === "not_found") {
    return { text: `"${from}" isn't in your price list. Check /prices.` };
  }
  if (result === "target_exists") {
    return {
      text:
        `You already have "${to}" in your price list.\n\n` +
        `Remove one of them first:  /remove ${from}`,
    };
  }
  return { text: `Renamed "${from}" to "${to}". Past bills keep the name they were made with.` };
}

async function handlePrices(businessId: string): Promise<string> {
  const catalog = await loadCatalog(businessId);
  if (catalog.products.length === 0) {
    return "Your price list is empty. Add items with:\n  /add paneer 120";
  }
  const lines = catalog.products
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `${p.name} — ₹${p.price}`);
  return `Your prices:\n\n${lines.join("\n")}`;
}

async function handleRemove(businessId: string, args: string): Promise<string> {
  const name = args.trim();
  if (name.length === 0) return "Use: /remove <item>\nExample: /remove lassi";
  const removed = await deactivateProduct(businessId, name);
  return removed ? `Removed: ${name}` : `"${name}" isn't in your price list.`;
}

// The core flow: order text -> existing pipeline (now catalog-aware) -> bill.
async function handleOrder(
  businessId: string,
  text: string,
  sourceMessageId: string | null,
  onSlowWork?: () => Promise<void>,
): Promise<Reply> {
  await onSlowWork?.();
  const catalog = await loadCatalog(businessId);

  if (catalog.products.length === 0) {
    return {
      text:
        "Your price list is empty, so I can only bill orders that include prices.\n\n" +
        "Send me your rates first, one per line:\n  paneer 120\n  samosa 20\n\n" +
        "Or state the price in the order itself:\n  2 paneer 120",
    };
  }

  try {
    const { parsed } = await routeParseOrder(text, { catalog });
    const bill = calculateBill(parsed.items, parsed.discountPercent ?? 0);
    // Persist as a draft so the bill survives the reply and can be looked
    // at, edited and updated later. This is what makes it a transaction
    // rather than a one-off message.
    const stored = await createBillSession(businessId, parsed, bill, sourceMessageId);
    return { text: renderStoredBill(stored), actions: billActions(stored) };
  } catch (err) {
    return { text: (err as Error).message };
  }
}

// Manual edit. Parsed deterministically — NO model, no trust layer: the
// seller is stating exactly what they want, so there is nothing to infer
// and nothing to approve. This is a different path from Check Updates,
// where the model PROPOSES changes that the seller must confirm.
//
//   /plus 2 chutney        price from the seller's list
//   /plus 2 chutney 15     price stated explicitly, wins
async function handleAddItem(businessId: string, args: string): Promise<Reply> {
  const draft = await getCurrentDraft(businessId);
  if (!draft) return { text: "No open bill yet. Send me an order and I'll make one." };

  const tokens = args.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length < 2) {
    return { text: "Tell me what to add, like:\n  add 2 chutney" };
  }

  const quantity = Number(tokens[0]);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { text: `"${tokens[0]}" isn't a quantity. Try: add 2 chutney` };
  }

  // A trailing number is an explicit price for this bill only.
  const maybePrice = Number(tokens[tokens.length - 1]);
  const hasStatedPrice = tokens.length > 2 && Number.isFinite(maybePrice) && maybePrice > 0;
  const rawName = (hasStatedPrice ? tokens.slice(1, -1) : tokens.slice(1)).join(" ");

  if (rawName.length === 0) return { text: "Which item? Try: add 2 chutney" };

  let unitPrice: number;
  let productId: string | null = null;
  let priceSource: "stated" | "catalog" | "manual";
  let name = rawName;

  if (hasStatedPrice) {
    unitPrice = maybePrice;
    priceSource = "manual";
  } else {
    // Same price store and the SAME tiered matching the order path uses,
    // so "add 2 lasssi" behaves identically to billing "2 lasssi".
    const catalog = await loadCatalog(businessId);
    const index = buildCatalogIndex(catalog);
    const found = findProduct(name, index);
    if (found === "ambiguous") {
      return { text: `"${name}" matches more than one item in your price list. Which one?` };
    }
    const match = found?.product ?? null;
    if (!match) {
      return { text: `I don't have a price for "${name}".\n\nSend me the rate:  ${name} 50\nOr state it here:  add ${quantity} ${name} 50` };
    }
    unitPrice = match.price;
    productId = match.id;
    priceSource = "catalog";
    // Canonical name on the bill, so a near-match is visible.
    name = match.name;
  }

  const updated = await addItemToBill(draft.session.id, {
    name,
    quantity,
    unitPrice,
    productId,
    priceSource,
  });
  return { text: `Added ${name} × ${quantity}.\n\n${renderStoredBill(updated)}`, actions: billActions(updated) };
}

async function handleRemoveItem(businessId: string, args: string): Promise<Reply> {
  const draft = await getCurrentDraft(businessId);
  if (!draft) return { text: "No open bill to change. Send me an order first." };

  const name = args.trim();
  if (name.length === 0) return { text: "Which item should I remove?" };

  const updated = await removeItemFromBill(draft.session.id, name);
  if (!updated) return { text: `"${name}" isn't on this bill.` };
  if (updated.items.length === 0) return { text: "That was the last item — the bill is now empty." };
  return { text: `Removed ${name}.\n\n${renderStoredBill(updated)}`, actions: billActions(updated) };
}

async function handleShowBill(businessId: string): Promise<Reply> {
  const draft = await getCurrentDraft(businessId);
  if (!draft) return { text: "No open bill. Send me an order and I'll make one." };
  return { text: renderStoredBill(draft), actions: billActions(draft) };
}

// Resolves which bill the seller means: the one they named ("#1042"), or
// the one they're currently working on. Never guesses across businesses.
async function resolveBill(businessId: string, billNo: number | null): Promise<StoredBill | null> {
  if (billNo !== null) return getBillByNo(businessId, billNo);
  return getCurrentDraft(businessId);
}

async function handleConfirm(businessId: string, billNo: number | null): Promise<Reply> {
  const bill = await resolveBill(businessId, billNo);
  if (!bill) return { text: "No open bill to confirm. Send me an order and I'll make one." };
  if (bill.session.status === "finalized") {
    return { text: `Bill #${bill.session.bill_no} is already confirmed.`, actions: billActions(bill) };
  }

  await finalizeBill(bill.session.id);
  const sales = await getTodaysSales(businessId);
  const confirmed = {
    ...bill,
    session: { ...bill.session, status: "finalized" as const },
  };
  return {
    text:
      `${renderStoredBill(confirmed)}\n\n` +
      `Confirmed. Today: ${sales.count} bill(s), ${formatRupees(sales.total)}` +
      (sales.openCount > 0
        ? `\n${sales.openCount} still unconfirmed \u2014 say "open bills".`
        : ""),
    actions: billActions(confirmed),
  };
}

// Payment is recorded only from the SELLER's explicit statement. A customer
// saying "paid" never reaches this — that is a claim, not a receipt.
async function handlePayment(
  businessId: string,
  billNo: number | null,
  amount: number | null,
): Promise<Reply> {
  const bill = await resolveBill(businessId, billNo);
  if (!bill) {
    return { text: "Which bill was paid? Tell me the number, like: #1042 paid" };
  }

  const updated = await recordPayment(bill.session.id, amount);
  if (!updated) return { text: "Couldn't find that bill." };

  const note =
    updated.session.payment_status === "paid"
      ? `Marked #${updated.session.bill_no} paid in full.`
      : `Recorded ${formatRupees(Number(updated.session.amount_paid))} against #${updated.session.bill_no}. ` +
        `${formatRupees(Number(updated.session.total) - Number(updated.session.amount_paid))} still due.`;

  return { text: `${note}\n\n${renderStoredBill(updated)}`, actions: billActions(updated) };
}

async function handleDone(businessId: string): Promise<Reply> {
  return handleConfirm(businessId, null);
}

// Reports confirmed sales AND unconfirmed drafts. Showing only confirmed
// bills was technically true and practically misleading: a seller who had
// made a dozen bills saw a total covering two of them, with no indication
// the rest existed or how to find them.
async function handleSales(businessId: string, text: string): Promise<Reply> {
  // "sales", "yesterday sales", "sales 8 sep", "this month" — the period
  // comes from the seller's own words; no period means today.
  const range = parseDateRange(text);
  const label = range?.label ?? "Today";
  const s = await getSales(businessId, range ?? undefined);

  if (s.count === 0 && s.openCount === 0) {
    // "today"/"yesterday" read as adverbs; a named period needs "on".
    const when =
      label === "Today" || label === "Yesterday"
        ? label.toLowerCase()
        : `in ${label.toLowerCase()}`.replace("in last 7 days", "in the last 7 days");
    return { text: `Nothing billed ${when}.` };
  }

  const lines = [label];

  if (s.count > 0) {
    lines.push("", `${s.count} confirmed \u2014 ${formatRupees(s.total)}`);
    if (s.unpaidTotal > 0) {
      lines.push(`  ${formatRupees(s.paidTotal)} collected`);
      lines.push(`  ${formatRupees(s.unpaidTotal)} still owed`);
    } else {
      lines.push("  all paid");
    }
  } else {
    lines.push("", "Nothing confirmed yet.");
  }

  if (s.openCount > 0) {
    lines.push(
      "",
      `${s.openCount} unconfirmed \u2014 ${formatRupees(s.openTotal)}`,
      "These aren't counted yet. Say \"open bills\" to see them.",
    );
  }

  return { text: lines.join("\n") };
}

async function handleOpenBills(businessId: string): Promise<Reply> {
  const open = await getOpenBills(businessId);
  if (open.length === 0) {
    return { text: "No unconfirmed bills today \u2014 everything is closed off." };
  }
  const lines = open.map(
    (b) =>
      `#${b.bill_no}  ${b.customer_ref ? titleCase(b.customer_ref) : "no name"}  ` +
      `${formatRupees(Number(b.total))}  \u00b7  ${formatBusinessDateTime(new Date(b.created_at))}`,
  );
  return {
    text:
      `${open.length} unconfirmed bill(s):\n\n${lines.join("\n")}\n\n` +
      `Open one with "show #${open[0]!.bill_no}", then Confirm.`,
  };
}

// A correction ("actually paneer was 3") changes the bill that is already
// open. It is routed through the SAME deterministic edit path as an
// explicit "/plus" — the seller is stating a fact about their own order,
// so there is nothing to infer and nothing to approve.
async function handleCorrection(businessId: string, text: string): Promise<Reply> {
  const draft = await getCurrentDraft(businessId);
  if (!draft) {
    return { text: "There's no open bill to correct. Send me the order and I'll make one." };
  }

  // "actually paneer was 3" / "make it 3 paneer" / "change paneer to 3"
  const lower = text.toLowerCase();
  const patterns = [
    /(?:actually\s+)?([a-z ]+?)\s+(?:was|is|to|hai)\s+(\d+)/i,
    /(?:make it|change|update)\s+(\d+)\s+([a-z ]+)/i,
    /(\d+)\s+([a-z ]+?)\s*$/i,
  ];

  for (const pattern of patterns) {
    const m = lower.match(pattern);
    if (!m) continue;
    const [a, b] = [m[1]!.trim(), m[2]!.trim()];
    const quantity = Number(/^\d+$/.test(a) ? a : b);
    const name = /^\d+$/.test(a) ? b : a;
    if (!Number.isInteger(quantity) || quantity <= 0 || name.length === 0) continue;

    const onBill = draft.items.find(
      (i) => i.name_snapshot.toLowerCase() === name || name.includes(i.name_snapshot.toLowerCase()),
    );
    if (!onBill) continue;

    const updated = await setItemQuantity(draft.session.id, onBill.id, quantity);
    return {
      text: `Updated ${titleCase(onBill.name_snapshot)} to \u00d7 ${quantity}.\n\n${renderStoredBill(updated)}`,
      actions: billActions(updated),
    };
  }

  return {
    text:
      "I didn't catch what changed. Tell me like:\n" +
      "  paneer was 3\n  add 2 lassi\n  remove chutney",
  };
}

const GREETING_REPLY =
  "Hi! Send me an order and I'll make the bill.\n\n" +
  "  Ravi 2 paneer 1 lassi\n\n" +
  "You can also forward a customer's message straight to me.";

// Every command Likho understands. Commands are now OPTIONAL shortcuts —
// normal typing is handled by the intent layer — but they stay supported
// because a seller who learned them shouldn't be broken.
const KNOWN_COMMANDS = [
  "/start", "/help", "/add", "/prices", "/list", "/remove",
  "/zbill", "/plus", "/additem", "/minus", "/removeitem",
  "/bill", "/done", "/sales", "/paid", "/open", "/rename",
];

// Telegram caps callback_data at 64 BYTES. A rename carries two arbitrary
// product names, so it can overflow — in which case no button is offered
// and the seller is given the typed command instead. Returning null rather
// than truncating matters: a truncated name would rename the wrong thing.
const FIX_SEPARATOR = "\u001f"; // unit separator; cannot occur in a product name

export function encodeFix(from: string, to: string): string | null {
  const action = `fix:${from}${FIX_SEPARATOR}${to}`;
  return Buffer.byteLength(action, "utf8") <= 64 ? action : null;
}

export function decodeFix(action: string): { from: string; to: string } | null {
  if (!action.startsWith("fix:")) return null;
  const [from, to] = action.slice(4).split(FIX_SEPARATOR);
  if (!from || !to) return null;
  return { from, to };
}

// Merging drops the older duplicate and keeps what the seller just typed.
export function encodeMerge(drop: string): string | null {
  const action = `merge:${drop}`;
  return Buffer.byteLength(action, "utf8") <= 64 ? action : null;
}

export function decodeMerge(action: string): string | null {
  if (!action.startsWith("merge:")) return null;
  const name = action.slice(6);
  return name.length > 0 ? name : null;
}

export interface ParsedCommand {
  command: string;
  args: string;
}

// THE RULE: one message = a sequence of commands, run top to bottom.
//
// A command starts at the beginning of a line, or mid-line after
// whitespace. Everything up to the next command is its arguments:
//
//   /add samosa 20\nchai 15         -> one /add, two lines of arguments
//   /zbill 2 chai\n/plus 1 mithai   -> two commands
//   /zbill 2 chai /plus 1 mithai    -> two commands (same line)
//
// Splitting deterministically here means the model never has to guess
// whether "/add mithai 10" was an instruction or part of an order.
export function splitCommands(text: string): ParsedCommand[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const hits: { index: number; command: string }[] = [];
  for (const cmd of KNOWN_COMMANDS) {
    const pattern = new RegExp(`(^|\\s)(${cmd})(?=\\s|$)`, "gi");
    for (const m of trimmed.matchAll(pattern)) {
      hits.push({ index: m.index! + m[1]!.length, command: cmd });
    }
  }

  if (hits.length === 0) return [{ command: "", args: trimmed }];

  hits.sort((a, b) => a.index - b.index);

  // Text BEFORE the first command belongs to that command. It used to be
  // discarded, which silently dropped the customer from
  // "ria bhanushali /zbill 3 mudpie" — the bill came out with no name and
  // nothing indicated why. People put the command where it falls in the
  // sentence; the parser has to read the whole sentence.
  const prefix = trimmed.slice(0, hits[0]!.index).trim();

  const parsed: ParsedCommand[] = [];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    const argsStart = hit.index + hit.command.length;
    const argsEnd = i + 1 < hits.length ? hits[i + 1]!.index : trimmed.length;
    const args = trimmed.slice(argsStart, argsEnd).trim();
    parsed.push({
      command: hit.command.toLowerCase(),
      args: i === 0 && prefix.length > 0 ? `${prefix} ${args}`.trim() : args,
    });
  }
  return parsed;
}

async function resolveBusiness(incoming: IncomingMessage): Promise<string> {
  return getOrCreateBusinessForChannel(
    incoming.platform,
    incoming.platformUserId,
    incoming.displayName,
  );
}

export async function handleIncoming(incoming: IncomingMessage): Promise<Reply> {
  let businessId: string;
  try {
    businessId = await resolveBusiness(incoming);
  } catch (err) {
    return { text: `Couldn't reach the price store: ${(err as Error).message}` };
  }

  // A forwarded message IS the order. The seller forwarded it precisely so
  // they wouldn't have to retype it, so it is treated as the order text
  // with no command required.
  const orderText = incoming.forwardedText?.trim();
  const trimmed = (orderText && orderText.length > 0 ? orderText : incoming.text).trim();
  const sourceMessageId = incoming.messageId ?? null;

  const commands = splitCommands(trimmed);

  // Explicit commands still win — a seller who typed one meant it.
  if (commands.length > 1 || (commands[0] && commands[0].command !== "")) {
    const replies: Reply[] = [];
    for (const c of commands) {
      replies.push(await runCommand(businessId, incoming, c.command, c.args, trimmed, sourceMessageId));
    }
    if (replies.length === 1) return replies[0]!;
    return {
      text: replies.map((r) => r.text).join("\n\n———\n\n"),
      // Actions from the LAST reply — that's the state the seller ends on.
      actions: replies[replies.length - 1]!.actions,
    };
  }

  // No command: the conversation layer decides.
  return runIntent(businessId, incoming, trimmed, sourceMessageId);
}

// Natural-language dispatch. This is what makes commands optional.
async function runIntent(
  businessId: string,
  incoming: IncomingMessage,
  text: string,
  sourceMessageId: string | null,
): Promise<Reply> {
  const intent = classifyIntent(text);

  try {
    switch (intent.name) {
      case "help":
        return { text: HELP };
      case "greeting":
        return { text: GREETING_REPLY };
      case "prices":
        return { text: await handlePrices(businessId) };
      case "sales":
        return await handleSales(businessId, text);
      case "open_bills":
        return await handleOpenBills(businessId);
      case "show_bill": {
        const bill = await resolveBill(businessId, intent.billNo);
        if (!bill) {
          return {
            text: intent.billNo
              ? `I don't have a bill #${intent.billNo}.`
              : "No open bill. Send me an order and I'll make one.",
          };
        }
        return { text: renderStoredBill(bill), actions: billActions(bill) };
      }
      case "confirm":
        return await handleConfirm(businessId, intent.billNo);
      case "payment":
        return await handlePayment(businessId, intent.billNo, intent.amount);
      case "pdf":
        return { text: "PDF export isn't ready yet — the bill above is the record for now." };
      case "rename":
        return await handleRename(businessId, intent.text);
      case "add_item":
        // Same deterministic edit path "/plus" uses — no model involved,
        // because the seller is stating exactly what they want.
        return await handleAddItem(businessId, intent.text);
      case "remove_item":
        return await handleRemoveItem(businessId, intent.text);
      case "correction":
        return await handleCorrection(businessId, text);
      case "order":
      default:
        return await handleOrder(businessId, text, sourceMessageId, incoming.onSlowWork);
    }
  } catch (err) {
    return { text: `Something went wrong: ${(err as Error).message}` };
  }
}

// A button press runs the SAME handlers a typed message does, so the two
// can never drift apart. The action string is opaque to the channel.
export async function handleAction(incoming: IncomingMessage, action: string): Promise<Reply> {
  let businessId: string;
  try {
    businessId = await resolveBusiness(incoming);
  } catch (err) {
    return { text: `Couldn't reach the price store: ${(err as Error).message}` };
  }

  // A spelling fix carries two names rather than a bill number, so it is
  // decoded before the number-based actions.
  const drop = decodeMerge(action);
  if (drop) {
    try {
      const removed = await deactivateProduct(businessId, drop);
      return {
        text: removed
          ? `Dropped "${drop}". Past bills that used it keep the name and price they were made with.`
          : `"${drop}" isn't in your price list any more.`,
      };
    } catch (err) {
      return { text: `Something went wrong: ${(err as Error).message}` };
    }
  }

  const fix = decodeFix(action);
  if (fix) {
    try {
      return await handleRename(businessId, `${fix.from} to ${fix.to}`);
    } catch (err) {
      return { text: `Something went wrong: ${(err as Error).message}` };
    }
  }

  const [verb, rawNo] = action.split(":");
  const billNo = rawNo && /^\d+$/.test(rawNo) ? Number(rawNo) : null;

  try {
    switch (verb) {
      case "confirm":
        return await handleConfirm(businessId, billNo);
      case "paid":
        return await handlePayment(businessId, billNo, null);
      case "pdf":
        return { text: "PDF export isn't ready yet — the bill above is the record for now." };
      default:
        return { text: "That action isn't available." };
    }
  } catch (err) {
    return { text: `Something went wrong: ${(err as Error).message}` };
  }
}

async function runCommand(
  businessId: string,
  incoming: IncomingMessage,
  command: string,
  args: string,
  trimmed: string,
  sourceMessageId: string | null,
): Promise<Reply> {
  const { onSlowWork } = incoming;
  try {
    switch (command) {
      case "/start":
      case "/help":
        return { text: HELP };
      case "/add":
        return await handleAdd(businessId, args);
      case "/prices":
      case "/list":
        return { text: await handlePrices(businessId) };
      case "/remove":
        return { text: await handleRemove(businessId, args) };
      case "/rename":
        return await handleRename(businessId, args);
      case "/zbill": {
        const replied = incoming.repliedText?.trim();
        const orderText = args.trim().length > 0 ? args.trim() : replied ?? "";
        if (orderText.length === 0) {
          return {
            text:
              "Send the order with it, or reply to the customer's message:\n" +
              "  /zbill 2 paneer 3 samosa",
          };
        }
        const anchorId =
          replied && args.trim().length === 0 && incoming.repliedMessageId
            ? incoming.repliedMessageId
            : sourceMessageId;
        return await handleOrder(businessId, orderText, anchorId, onSlowWork);
      }
      case "/plus":
      case "/additem":
        return await handleAddItem(businessId, args);
      case "/minus":
      case "/removeitem":
        return await handleRemoveItem(businessId, args);
      case "/bill":
        return await handleShowBill(businessId);
      case "/done":
        return await handleDone(businessId);
      case "/paid":
        return await handlePayment(businessId, null, null);
      case "/sales":
        return await handleSales(businessId, args.length > 0 ? args : trimmed);
      case "/open":
        return await handleOpenBills(businessId);
      default:
        // An unrecognised slash command is a typo, not an order — never
        // silently bill it.
        return { text: `I don't know that command.\n\n${HELP}` };
    }
  } catch (err) {
    return { text: `Something went wrong: ${(err as Error).message}` };
  }
}
