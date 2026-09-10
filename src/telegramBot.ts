import { handleIncoming, handleAction, type Reply, type IncomingMessage } from "./messageHandler.js";

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
  // Present on a forwarded message. Telegram moved from forward_from to
  // forward_origin; both are accepted so older clients still work.
  forward_origin?: unknown;
  forward_from?: unknown;
  forward_sender_name?: string;
  forward_date?: number;
}

interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
  from?: { id: number; first_name?: string; username?: string };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramGetUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
  error_code?: number;
  description?: string;
}

// Renders the core's channel-independent actions as Telegram inline
// buttons. The core never knows these are buttons; another channel can
// present the same actions as a numbered list or quick replies.
function toInlineKeyboard(reply: Reply): unknown {
  if (!reply.actions || reply.actions.length === 0) return undefined;
  return {
    inline_keyboard: [
      reply.actions.map((a) => ({ text: a.label, callback_data: a.action })),
    ],
  };
}

async function sendReply(chatId: number, reply: Reply): Promise<void> {
  if (!API_BASE) return;
  const response = await fetch(`${API_BASE}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: reply.text,
      reply_markup: toInlineKeyboard(reply),
    }),
  });
  if (!response.ok) {
    throw new Error(`sendMessage failed (${response.status}): ${await response.text()}`);
  }
}

async function sendMessage(chatId: number, text: string): Promise<void> {
  await sendReply(chatId, { text });
}

// Telegram shows a loading spinner on the button until this is called.
async function answerCallback(callbackId: string): Promise<void> {
  if (!API_BASE) return;
  try {
    await fetch(`${API_BASE}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackId }),
    });
  } catch {
    // Cosmetic only.
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

function isForwarded(message: TelegramMessage): boolean {
  return (
    message.forward_origin != null ||
    message.forward_from != null ||
    message.forward_sender_name != null ||
    message.forward_date != null
  );
}

function toIncoming(message: TelegramMessage, text: string): IncomingMessage {
  const chatId = message.chat.id;
  return {
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
    forwardedText: isForwarded(message) ? text : null,
    onSlowWork: () => sendTyping(chatId),
  };
}

async function handleMessage(message: TelegramMessage, text: string): Promise<Reply> {
  return handleIncoming(toIncoming(message, text));
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
        const callback = update.callback_query;
        if (callback?.data && callback.message) {
          // A button press runs the same core handlers a typed message
          // does, so the two paths cannot drift apart.
          const chatId = callback.message.chat.id;
          console.log(`[telegram] <- chat=${chatId} button=${callback.data}`);
          await answerCallback(callback.id);
          const reply = await handleAction(toIncoming(callback.message, ""), callback.data);
          await sendReply(chatId, reply);
          console.log(`[telegram] -> chat=${chatId} action replied`);
        } else if (message && text) {
          console.log(
            `[telegram] <- chat=${message.chat.id}${isForwarded(message) ? " (forwarded)" : ""} ${JSON.stringify(text)}`,
          );
          const reply = await handleMessage(message, text);
          await sendReply(message.chat.id, reply);
          console.log(`[telegram] -> chat=${message.chat.id} replied (${reply.text.length} chars)`);
        }
      } catch (err) {
        // Log loudly and still try to tell the seller something, so a
        // failure is never invisible on either side.
        console.error(`[telegram] FAILED update ${update.update_id}:`, err);
        const failChat = message?.chat.id ?? update.callback_query?.message?.chat.id;
        if (failChat != null) {
          await sendMessage(
            failChat,
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
