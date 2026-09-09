import { routeParseOrder } from "./router.js";
import { calculateBill } from "./calculator.js";
import { formatBill } from "./formatter.js";
import { getOrCreateBusinessForChannel, loadCatalog, upsertProduct, deactivateProduct } from "./catalogStore.js";

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
  chat: TelegramChat;
  text?: string;
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

const HELP = `Likho — send me the order, I'll make the bill.

First, set your prices:
  /add paneer 120
  /add samosa 20
  /add lassi 100

See them any time:
  /prices

Remove one:
  /remove lassi

Then just send the order, no prices needed:
  2 paneer, 4 samosa and 1 lassi

You can still state a price in the order to override your list for that bill:
  2 paneer 150`;

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
async function handleOrder(businessId: string, chatId: number, text: string): Promise<string> {
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
    return formatBill(bill, parsed.customer);
  } catch (err) {
    return (err as Error).message;
  }
}

async function handleMessage(message: TelegramMessage, text: string): Promise<string> {
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
      default:
        if (command.startsWith("/")) return `Unknown command.\n\n${HELP}`;
        return await handleOrder(businessId, chatId, trimmed);
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
