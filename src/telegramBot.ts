import { routeParseOrder } from "./router.js";
import { calculateBill } from "./calculator.js";
import { formatBill } from "./formatter.js";
import { getOrCreateBusinessForChannel, loadCatalog, upsertProduct, deactivateProduct } from "./catalogStore.js";
import { createBillSession, getCurrentDraft, finalizeBill, getTodaysSales, type StoredBill } from "./billStore.js";

// Telegram adapter. Deliberately thin: it owns message plumbing and command
// routing only. All order understanding, validation, trust and money math
// stays in the core (router/structuredOrder/trustLayer/calculator), so the
// same logic serves WhatsApp later without change.
const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"];
const API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;
const LONG_POLL_TIMEOUT_SECONDS = 30;

interface TelegramChat {
  id: number;
  first_name?: string;
  username?: string;
}

interface TelegramMessage {
  message_id?: number;
  chat: TelegramChat;
  text?: string;
  // Populated when the seller replies to a message. This is how an order
  // written by someone else gets handed to Likho without retyping it.
  reply_to_message?: { message_id?: number; text?: string };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramGetUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
  error_code?: number;
  description?: string;
}

async function sendMessage(chatId: number, text: string): Promise<void> {
  if (!API_BASE) return;
  const response = await fetch(`${API_BASE}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!response.ok) {
    throw new Error(`sendMessage failed (${response.status}): ${await response.text()}`);
  }
}

// Understanding an order takes several seconds on the local model. Without
// this the chat just sits silent and looks broken.
async function sendTyping(chatId: number): Promise<void> {
  if (!API_BASE) return;
  try {
    await fetch(`${API_BASE}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch {
    // Purely cosmetic — never let this affect the actual reply.
  }
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

Then send the order, no prices needed:
  2 paneer, 4 samosa and 1 lassi

Or use the trigger explicitly:
  /zbill 2 paneer 3 samosa

To bill someone else's message, long-press it → Reply → /zbill

You can still state a price in the order to override your list for that bill:
  2 paneer 150

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
  chatId: number,
  text: string,
  sourceMessageId: string | null,
): Promise<string> {
  await sendTyping(chatId);
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

async function handleMessage(message: TelegramMessage, text: string): Promise<string> {
  const sourceMessageId = message.message_id != null ? String(message.message_id) : null;
  const chatId = message.chat.id;
  const displayName = message.chat.first_name ?? message.chat.username ?? `telegram:${chatId}`;

  let businessId: string;
  try {
    businessId = await getOrCreateBusinessForChannel("telegram", String(chatId), displayName);
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
        const replied = message.reply_to_message?.text?.trim();
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
          replied && args.trim().length === 0 && message.reply_to_message?.message_id != null
            ? String(message.reply_to_message.message_id)
            : sourceMessageId;
        return await handleOrder(businessId, chatId, orderText, anchorId);
      }
      case "/bill":
        return await handleShowBill(businessId);
      case "/done":
        return await handleDone(businessId);
      case "/sales":
        return await handleSales(businessId);
      default:
        if (command.startsWith("/")) return `Unknown command.\n\n${HELP}`;
        return await handleOrder(businessId, chatId, trimmed, sourceMessageId);
    }
  } catch (err) {
    return `Something went wrong: ${(err as Error).message}`;
  }
}

async function pollLoop(): Promise<void> {
  let offset = 0;
  console.log("Likho Telegram bot running. Send /help to the bot to begin.");

  for (;;) {
    let data: TelegramGetUpdatesResponse;
    try {
      const response = await fetch(
        `${API_BASE}/getUpdates?timeout=${LONG_POLL_TIMEOUT_SECONDS}&offset=${offset}`,
      );
      data = (await response.json()) as TelegramGetUpdatesResponse;
    } catch (err) {
      console.error("Failed to poll Telegram, retrying in 3s:", (err as Error).message);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      continue;
    }

    if (!data.ok) {
      // Never swallow this silently. A 409 here means another copy of the
      // bot is polling the same token, and the two instances split incoming
      // messages between them — which looks exactly like messages randomly
      // going unanswered.
      console.error(
        `[telegram] getUpdates returned not-ok: ${JSON.stringify(data).slice(0, 200)}`,
      );
      if (data.error_code === 409) {
        console.error(
          "[telegram] 409 Conflict — another instance of this bot is already running. " +
            "Stop the other one (pkill -f telegramBot.js), or messages will keep going missing.",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
      continue;
    }

    for (const update of data.result) {
      const message = update.message;
      const text = message?.text;

      // Each update is fully isolated: one failure must never kill the poll
      // loop or take unrelated messages down with it. Previously an
      // exception here escaped pollLoop entirely and the bot died silently.
      try {
        if (message && text) {
          console.log(`[telegram] <- chat=${message.chat.id} ${JSON.stringify(text)}`);
          const reply = await handleMessage(message, text);
          await sendMessage(message.chat.id, reply);
          console.log(`[telegram] -> chat=${message.chat.id} replied (${reply.length} chars)`);
        }
      } catch (err) {
        // Log loudly and still try to tell the seller something, so a
        // failure is never invisible on either side.
        console.error(`[telegram] FAILED update ${update.update_id}:`, err);
        if (message) {
          await sendMessage(
            message.chat.id,
            "Something went wrong handling that message. Please try again.",
          ).catch(() => undefined);
        }
      } finally {
        // Advance only after the attempt completes, so a crash mid-process
        // cannot silently consume a message without answering it.
        offset = update.update_id + 1;
      }
    }
  }
}

async function main() {
  if (!BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN is not set. Export it before running, e.g.:");
    console.error('  export TELEGRAM_BOT_TOKEN="123456:ABC-your-bot-token"');
    process.exit(1);
  }
  await pollLoop();
}

main();
