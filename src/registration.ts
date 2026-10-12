import { rest, getOrCreateBusinessForChannel } from "./catalogStore.js";
import type { Reply } from "./reply.js";

// Phone registration, confirmed by Telegram — the Telegram channel's door.
//
// A seller can't bill until this chat has a verified number. The number
// comes from Telegram's own "share contact" button, never typed, and is
// accepted only when it is the sender's OWN contact: anyone can forward
// someone else's contact card, so contact.user_id must equal the sender.
//
// Lives in the channel layer on purpose: the core billing logic, the API
// and the evals stay channel-independent and unaffected.

export const SHARE_PHONE_LABEL = "\u{1f4f1} Share my phone number";

// Verified chats, so a registered seller costs no lookup per message. A
// number is never un-verified, so the cache can't go stale in that direction.
const verified = new Set<string>();

const channelFilter = (chatId: string) =>
  `business_channels?platform=eq.telegram&platform_user_id=eq.${encodeURIComponent(chatId)}`;

export async function isRegistered(chatId: string): Promise<boolean> {
  if (verified.has(chatId)) return true;
  let rows: { verified_phone: string | null }[];
  try {
    rows = (await rest(`${channelFilter(chatId)}&select=verified_phone&limit=1`)) as typeof rows;
  } catch (err) {
    // The column arrives with supabase/migrations/20261012_verified_phone.sql.
    // Until that has been run, registration is OFF rather than every message
    // failing — a restart before the migration must not take billing down.
    if (/verified_phone|42703/.test((err as Error).message)) {
      console.error("[registration] verified_phone column missing — registration is off until the migration runs");
      return true;
    }
    throw err;
  }
  const ok = Boolean(rows[0]?.verified_phone);
  if (ok) verified.add(chatId);
  return ok;
}

export function registrationPrompt(retry = false): Reply {
  return {
    text: retry
      ? "Please tap the button below to share your own number."
      : "\u{1f44b} Welcome to Likho.\n\n" +
        "Register with your phone number to start. Tap the button below — " +
        "Telegram sends your number securely, nothing to type.",
    requestContact: SHARE_PHONE_LABEL,
  };
}

// "+91 98200 41122" and "919820041122" are one number; stored as "+<digits>".
export function normalizePhone(raw: string): string {
  return `+${raw.replace(/\D/g, "")}`;
}

export async function registerContact(
  chatId: string,
  displayName: string,
  contact: { phone_number: string; user_id?: number },
  senderId: number | undefined,
): Promise<Reply> {
  if (contact.user_id === undefined || senderId === undefined || contact.user_id !== senderId) {
    return registrationPrompt(true);
  }
  const phone = normalizePhone(contact.phone_number);
  await getOrCreateBusinessForChannel("telegram", chatId, displayName);
  await rest(channelFilter(chatId), {
    method: "PATCH",
    body: JSON.stringify({ verified_phone: phone, phone_verified_at: new Date().toISOString() }),
  });
  verified.add(chatId);
  return { text: `✅ Registered: ${phone}`, removeKeyboard: true };
}
