import { handleIncoming } from "./messageHandler.js";

// Telegram transport only: receive updates, hand them to the shared
// message handler, send the reply back. All command routing, billing and
// state live in messageHandler.ts so Telegram and the n8n HTTP path behave
// identically.
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

async function handleMessage(message: TelegramMessage, text: string): Promise<string> {
  const chatId = message.chat.id;
  return handleIncoming({
    platform: "telegram",
    platformUserId: String(chatId),
    displayName: message.chat.first_name ?? message.chat.username ?? `telegram:${chatId}`,
    text,
    messageId: message.message_id != null ? String(message.message_id) : null,
    repliedText: message.reply_to_message?.text ?? null,
    repliedMessageId:
      message.reply_to_message?.message_id != null
        ? String(message.reply_to_message.message_id)
        : null,
    onSlowWork: () => sendTyping(chatId),
  });
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
