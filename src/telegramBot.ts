import { handleIncoming, handleAction, type Reply, type IncomingMessage } from "./messageHandler.js";
import { promises as fs, readFileSync, writeFileSync } from "node:fs";
import { isRegistered, registerContact, registrationPrompt } from "./registration.js";
import { isRepeatedBareCommand } from "./repeatCommand.js";
import path from "node:path";

// Telegram transport only: receive updates, hand them to the shared
// message handler, send the reply back. All command routing, billing and
// state live in messageHandler.ts so Telegram and the n8n HTTP path behave
// identically.
const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"];
const API_BASE = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;
const LONG_POLL_TIMEOUT_SECONDS = 30;

interface TelegramChat {
  id: number;
  // "private" for a one-to-one chat; "group", "supergroup" or "channel" otherwise.
  type?: string;
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
  from?: { id: number };
  // Sent by the "Share my phone number" button.
  contact?: { phone_number: string; user_id?: number };
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

  const buttons = reply.actions.map((a) => ({ text: a.label, callback_data: a.action }));

  // Long labels ("panner -> paneer") get their own row; short ones sit
  // three across. Everything on one row squeezes long labels until they
  // are unreadable on a phone.
  const perRow = buttons.some((b) => b.text.length > 16) ? 1 : 3;

  const rows: (typeof buttons)[] = [];
  for (let i = 0; i < buttons.length; i += perRow) {
    rows.push(buttons.slice(i, i + perRow));
  }
  return { inline_keyboard: rows };
}

// multipart upload, hand-rolled: Telegram wants a file, and adding a
// form-data dependency for two endpoints is not worth it.
// A DROPPED CONNECTION IS RETRIED, NOT A LOST REPLY. A "/sales" report was
// computed and then lost to one ECONNRESET while sending — and the
// "something went wrong" fallback went down the same broken connection, so
// the seller saw nothing at all. Network failures (no HTTP response) are
// retried up to 3 times; an HTTP error from Telegram is a real answer and is
// not. A reset after Telegram already accepted could, rarely, show a reply
// twice — better than the seller getting no reply.
async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (attempt >= attempts) throw err;
      console.error(`[telegram] network error, retry ${attempt}/${attempts - 1}:`, (err as Error).message);
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

async function sendFile(
  method: "sendPhoto" | "sendDocument" | "sendMediaGroup",
  chatId: number,
  files: { field: string; filePath: string }[],
  fields: Record<string, string>,
): Promise<void> {
  if (!API_BASE) return;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files) {
    const bytes = await fs.readFile(file.filePath);
    form.append(file.field, new Blob([bytes]), path.basename(file.filePath));
  }

  const response = await fetchWithRetry(`${API_BASE}/${method}`, { method: "POST", body: form });
  if (!response.ok) {
    throw new Error(`${method} failed (${response.status}): ${await response.text()}`);
  }
}

// Photos go first so the seller sees the bills before the question about
// them, then the text carries the buttons.
async function sendPhotos(chatId: number, photos: NonNullable<Reply["photos"]>): Promise<void> {
  if (photos.length === 0) return;

  if (photos.length === 1) {
    await sendFile("sendPhoto", chatId, [{ field: "photo", filePath: photos[0]!.path }],
      photos[0]!.caption ? { caption: photos[0]!.caption } : {});
    return;
  }

  // An album keeps six previews as one swipeable block instead of six
  // separate messages the seller has to scroll past. Telegram caps a media
  // group at 10.
  for (let start = 0; start < photos.length; start += 10) {
    const batch = photos.slice(start, start + 10);
    const media = batch.map((photo, i) => ({
      type: "photo",
      media: `attach://p${i}`,
      ...(photo.caption ? { caption: photo.caption } : {}),
    }));
    await sendFile(
      "sendMediaGroup",
      chatId,
      batch.map((photo, i) => ({ field: `p${i}`, filePath: photo.path })),
      { media: JSON.stringify(media) },
    );
  }
}

async function sendReply(chatId: number, reply: Reply): Promise<void> {
  if (!API_BASE) return;

  if (reply.photos?.length) {
    // A failed preview must not swallow the reply that carries the buttons.
    try {
      await sendPhotos(chatId, reply.photos);
    } catch (err) {
      console.error("[telegram] preview upload failed:", (err as Error).message);
    }
  }

  if (reply.document) {
    await sendFile("sendDocument", chatId, [{ field: "document", filePath: reply.document.path }],
      reply.document.caption ? { caption: reply.document.caption } : {});
    if (reply.text.trim().length === 0) return;
  }

  if (reply.text.trim().length === 0 && !reply.actions?.length) return;

  const response = await fetchWithRetry(`${API_BASE}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: reply.text,
      // Only set when the reply actually needs it. A bill table has to be
      // <pre> to land in a fixed-width font; ordinary replies stay
      // proportional, which reads better for prose.
      ...(reply.parseMode ? { parse_mode: reply.parseMode } : {}),
      reply_markup: reply.requestContact
        ? { keyboard: [[{ text: reply.requestContact, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
        : reply.removeKeyboard
          ? { remove_keyboard: true }
          : reply.inputPlaceholder && !reply.actions?.length
            ? { force_reply: true, input_field_placeholder: reply.inputPlaceholder.slice(0, 64) }
            : toInlineKeyboard(reply),
    }),
  });
  if (!response.ok) {
    throw new Error(`sendMessage failed (${response.status}): ${await response.text()}`);
  }

  // Separate bubbles, sent in order. One message cannot be half
  // proportional and half monospace, so a comparison needs several.
  for (const next of reply.follow ?? []) {
    await sendReply(chatId, next);
  }
}

async function sendMessage(chatId: number, text: string): Promise<void> {
  await sendReply(chatId, { text });
}

// THE SAME BARE COMMAND TWICE IN A FEW SECONDS IS ONE TAP.
//
// Telegram clients can send "/start" twice for one tap on Start (seen in
// the logs: two /start messages, two identical welcomes). A bare command
// repeated within seconds is never meant twice, so the repeat is deleted
// from the chat and not answered. Only bare commands: a repeated ORDER is
// already guarded by the one-message-one-bill check, and must still be
// visible.
const lastBareCommand = new Map<number, { text: string; at: number }>();


async function deleteMessage(chatId: number, messageId: number): Promise<void> {
  if (!API_BASE) return;
  // Best effort: if Telegram refuses, the duplicate simply stays visible.
  await fetch(`${API_BASE}/deleteMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
  }).catch(() => undefined);
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

// Where in Telegram's queue the bot is, kept on disk. In memory alone, a
// restart forgot it and Telegram redelivered messages already handled.
const OFFSET_FILE = new URL("../../logs/telegram.offset", import.meta.url);

function loadOffset(): number {
  try {
    const n = Number(readFileSync(OFFSET_FILE, "utf-8").trim());
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function saveOffset(offset: number): void {
  try {
    writeFileSync(OFFSET_FILE, String(offset));
  } catch (err) {
    console.error("[telegram] could not save offset:", err);
  }
}

async function pollLoop(): Promise<void> {
  let offset = loadOffset();
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
        const chat = message?.chat ?? callback?.message?.chat;

        // PRIVATE CHATS ONLY. In a group every member would share one shop:
        // anyone could make bills, mark them paid and read the sales.
        if (chat && chat.type && chat.type !== "private") {
          if (callback) await answerCallback(callback.id);
          else if (message) await sendMessage(chat.id, "Please use me in a private chat — open @zbillingbot and tap Start.");
          continue;
        }

        // A bare command sent twice for one tap: delete the repeat, answer once.
        // Checked before registration so the welcome is never shown twice.
        if (message && text && isRepeatedBareCommand(lastBareCommand, message.chat.id, text, Date.now())) {
          console.log(`[telegram] <- chat=${message.chat.id} repeated ${JSON.stringify(text)} within 5s — deleted, not answered`);
          if (message.message_id != null) await deleteMessage(message.chat.id, message.message_id);
          continue;
        }

        // REGISTRATION. A shared contact registers this chat; until then
        // nothing but the manual is available.
        if (message?.contact) {
          console.log(`[telegram] <- chat=${message.chat.id} shared a contact`);
          const registered = await registerContact(
            String(message.chat.id),
            message.chat.first_name ?? message.chat.username ?? `telegram:${message.chat.id}`,
            message.contact,
            message.from?.id,
          );
          await sendReply(message.chat.id, registered);
          // Straight on into setup (or the manual for an existing shop).
          if (registered.removeKeyboard) await sendReply(message.chat.id, await handleMessage(message, "/start"));
          continue;
        }
        const isManual = (callback?.data ?? "").startsWith("help:") || /^\/help\b/i.test(text ?? "");
        if (chat && (callback || text) && !isManual && !(await isRegistered(String(chat.id)))) {
          if (callback) await answerCallback(callback.id);
          await sendReply(chat.id, registrationPrompt());
          continue;
        }

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
        saveOffset(offset);
      }
    }
  }
}

// What a first-time visitor sees before typing anything: the "/" menu, the
// text in the empty chat, and the profile line. Set on every start so the
// code is the single source of truth. A failure here never stops the bot.
async function setBotProfile(): Promise<void> {
  const calls: [string, unknown][] = [
    [
      "setMyCommands",
      {
        commands: [
          { command: "start", description: "Set up your shop" },
          { command: "bill", description: "Make a bill" },
          { command: "add", description: "Add or change prices" },
          { command: "prices", description: "Your price list" },
          { command: "sales", description: "Sales report" },
          { command: "customers", description: "A customer's bills" },
          { command: "open", description: "Unconfirmed bills" },
          { command: "help", description: "How to use Likho" },
        ],
      },
    ],
    [
      "setMyDescription",
      {
        description:
          "Type an order, get a correct bill.\n\n" +
          "Works in Hinglish. Tracks sales and dues.\n\n" +
          "Tap Start to begin.",
      },
    ],
    ["setMyShortDescription", { short_description: "Type an order, get a correct bill." }],
  ];
  for (const [method, body] of calls) {
    try {
      const res = await fetch(`${API_BASE}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; description?: string };
      if (!data.ok) console.error(`[telegram] ${method} failed: ${data.description}`);
    } catch (err) {
      console.error(`[telegram] ${method} failed:`, err);
    }
  }
}

async function main() {
  if (!BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN is not set. Export it before running, e.g.:");
    console.error('  export TELEGRAM_BOT_TOKEN="123456:ABC-your-bot-token"');
    process.exit(1);
  }
  await setBotProfile();
  await pollLoop();
}

main();
