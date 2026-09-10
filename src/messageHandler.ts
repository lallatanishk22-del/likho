import { routeParseOrder } from "./router.js";
import { calculateBill } from "./calculator.js";
import { formatBill } from "./formatter.js";
import { getOrCreateBusinessForChannel, loadCatalog, upsertProduct, deactivateProduct } from "./catalogStore.js";
import { createBillSession, getCurrentDraft, finalizeBill, getTodaysSales, type StoredBill } from "./billStore.js";

// Platform-independent command routing. Telegram polling (telegramBot.ts)
// and the HTTP API used by n8n (apiServer.ts) both call handleIncoming(),
// so every channel gets identical behaviour and the logic cannot drift
// between them. Nothing here knows what Telegram is.

export type Platform = "telegram" | "whatsapp";

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
  // Optional hook so a slow channel can show a "working on it" signal.
  onSlowWork?: () => Promise<void>;
}

// Renders a bill from STORED state, so the seller always sees exactly what
// is persisted rather than a freshly recomputed guess.
function renderStoredBill(stored: StoredBill): string {
  const { session, items } = stored;
  const lines: string[] = [];
  if (session.customer_ref) {
    lines.push(session.customer_ref.toUpperCase(), "");
  }
  for (const item of items) {
    lines.push(`${item.name_snapshot} × ${item.quantity} — ₹${Number(item.line_total)}`);
  }
  lines.push("");
  if (Number(session.discount_percent) > 0) {
    lines.push(`Subtotal — ₹${Number(session.subtotal)}`);
    lines.push(`Discount (${Number(session.discount_percent)}%) — −₹${Number(session.discount_amount)}`);
  }
  lines.push(`TOTAL — ₹${Number(session.total)}`);
  lines.push("");
  lines.push(`Bill #${session.id.slice(0, 8)} · ${session.status}`);
  return lines.join("\n");
}

const HELP = `Likho — send me the order, I'll make the bill.

First, set your prices:
  /add paneer 120
  /add samosa 20
  /add lassi 100

See them any time:
  /prices

Remove one:
  /remove lassi

Then bill an order with /zbill:
  /zbill 2 paneer, 4 samosa and 1 lassi

No prices needed — I use your list.

To bill someone else's message, long-press it → Reply → /zbill

You can state a price to override your list for one bill:
  /zbill 2 paneer 150

Your current bill is remembered:
  /bill    show it again
  /done    mark it sent, count it in today's sales
  /sales   today's total`;

async function handleAdd(businessId: string, args: string): Promise<string> {
  // "/add paneer tikka 120" -> name = everything but the last token.
  const tokens = args.trim().split(/\s+/);
  const price = Number(tokens[tokens.length - 1]);
  const name = tokens.slice(0, -1).join(" ");

  if (tokens.length < 2 || !Number.isFinite(price) || price < 0 || name.length === 0) {
    return 'Use: /add <item> <price>\nExample: /add paneer 120';
  }

  await upsertProduct(businessId, name, price);
  return `Saved: ${name} — ₹${price}`;
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
): Promise<string> {
  await onSlowWork?.();
  const catalog = await loadCatalog(businessId);

  if (catalog.products.length === 0) {
    return (
      "Your price list is empty, so I can only bill orders that include prices.\n\n" +
      "Add your prices first:\n  /add paneer 120\n\nOr state prices in the order:\n  2 paneer 120"
    );
  }

  try {
    const { parsed } = await routeParseOrder(text, { catalog });
    const bill = calculateBill(parsed.items, parsed.discountPercent ?? 0);
    // Persist as a draft so the bill survives the reply and can be looked
    // at, edited and updated later. This is what makes it a transaction
    // rather than a one-off message.
    const stored = await createBillSession(businessId, parsed, bill, sourceMessageId);
    return `${renderStoredBill(stored)}\n\n/done when you've sent it to the customer.`;
  } catch (err) {
    return (err as Error).message;
  }
}

async function handleShowBill(businessId: string): Promise<string> {
  const draft = await getCurrentDraft(businessId);
  if (!draft) return "No open bill. Send me an order and I'll make one.";
  return renderStoredBill(draft);
}

async function handleDone(businessId: string): Promise<string> {
  const draft = await getCurrentDraft(businessId);
  if (!draft) return "No open bill to close.";
  await finalizeBill(draft.session.id);
  const sales = await getTodaysSales(businessId);
  return (
    `Bill #${draft.session.id.slice(0, 8)} closed — ₹${Number(draft.session.total)}.\n\n` +
    `Today: ${sales.count} bill(s), ₹${sales.total}`
  );
}

async function handleSales(businessId: string): Promise<string> {
  const sales = await getTodaysSales(businessId);
  if (sales.count === 0) return "No bills closed today yet.";
  return `Today's sales\n\n${sales.count} bill(s)\n₹${sales.total} billed`;
}

export async function handleIncoming(incoming: IncomingMessage): Promise<string> {
  const { platform, platformUserId, displayName, text, onSlowWork } = incoming;
  const sourceMessageId = incoming.messageId ?? null;

  let businessId: string;
  try {
    businessId = await getOrCreateBusinessForChannel(platform, platformUserId, displayName);
  } catch (err) {
    return `Couldn't reach the price store: ${(err as Error).message}`;
  }

  const trimmed = text.trim();
  const [rawCommand, ...rest] = trimmed.split(/\s+/);
  const command = (rawCommand ?? "").toLowerCase();
  const args = rest.join(" ");

  try {
    switch (command) {
      case "/start":
      case "/help":
        return HELP;
      case "/add":
        return await handleAdd(businessId, args);
      case "/prices":
      case "/list":
        return await handlePrices(businessId);
      case "/remove":
        return await handleRemove(businessId, args);
      case "/zbill": {
        // Order text comes from the replied-to message if there is one
        // (the "send this to Likho" gesture), otherwise from the rest of
        // this message.
        const replied = incoming.repliedText?.trim();
        const orderText = args.trim().length > 0 ? args.trim() : replied ?? "";
        if (orderText.length === 0) {
          return (
            "Send the order with it, or reply to the customer's message:\n" +
            "  /zbill 2 paneer 3 samosa\n\n" +
            "Or long-press their order → Reply → /zbill"
          );
        }
        // When billing a replied-to message, anchor the bill to THAT
        // message so Check Updates later knows where to resume from.
        const anchorId =
          replied && args.trim().length === 0 && incoming.repliedMessageId
            ? incoming.repliedMessageId
            : sourceMessageId;
        return await handleOrder(businessId, orderText, anchorId, onSlowWork);
      }
      case "/bill":
        return await handleShowBill(businessId);
      case "/done":
        return await handleDone(businessId);
      case "/sales":
        return await handleSales(businessId);
      default:
        if (command.startsWith("/")) return `Unknown command.\n\n${HELP}`;
        // A bill is only ever created when the seller explicitly asks for
        // one. Untriggered text is answered instantly without touching the
        // model — it costs nothing, it stops "hi" being parsed as an order,
        // and it is the same habit that keeps Likho out of the way when
        // this moves into real customer conversations.
        return (
          "Send it with /zbill and I'll make the bill:\n" +
          `  /zbill ${/\d/.test(trimmed) && trimmed.length <= 60 ? trimmed : "2 paneer 3 samosa"}\n\n` +
          "Or reply to the customer's order → /zbill\n\n" +
          "/help for everything else."
        );
    }
  } catch (err) {
    return `Something went wrong: ${(err as Error).message}`;
  }
}

