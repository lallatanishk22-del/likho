import { routeParseOrder } from "./router.js";
import { calculateBill } from "./calculator.js";
import { formatBill } from "./formatter.js";

// Minimal Telegram adapter for personal testing. Same pipeline as
// indexAi.ts (routeParseOrder -> calculateBill -> formatBill), just fed by
// Telegram's long-polling API instead of stdin, and replying via
// sendMessage instead of stdout. No new logic, no session/correction
// handling added: each Telegram message's raw text is passed through to
// routeParseOrder completely unmodified, exactly as indexAi.ts already
// does — there is no existing multi-message correction flow in the core to
// preserve (see LEARNINGS.md: correction handling is single-message today,
// with a 0% resolution rate, and untouched here), so "preserving context
// for it" means not mangling the message text before it reaches the core,
// nothing more.
const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"];
const API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;
const LONG_POLL_TIMEOUT_SECONDS = 30;

interface TelegramMessage {
  chat: { id: number };
  text?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramGetUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
}

async function sendMessage(chatId: number, text: string): Promise<void> {
  if (!API_BASE) return;
  await fetch(`${API_BASE}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// Same pipeline as indexAi.ts, just returning the reply text instead of
// printing it — no order-processing logic added here.
async function processOrderText(text: string): Promise<string> {
  try {
    const { parsed } = await routeParseOrder(text);
    const bill = calculateBill(parsed.items, parsed.discountPercent ?? 0);
    return formatBill(bill, parsed.customer);
  } catch (err) {
    return `Couldn't process that order: ${(err as Error).message}`;
  }
}

async function pollLoop(): Promise<void> {
  let offset = 0;
  console.log("Likho Telegram bot running. Send it an order message to test.");

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

    if (!data.ok) continue;

    for (const update of data.result) {
      offset = update.update_id + 1;
      const message = update.message;
      const text = message?.text;
      if (!message || !text) continue;

      console.log(`[telegram] chat=${message.chat.id} text=${JSON.stringify(text)}`);
      const reply = await processOrderText(text);
      await sendMessage(message.chat.id, reply);
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
