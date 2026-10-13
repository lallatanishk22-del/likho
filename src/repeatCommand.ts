// See telegramBot.ts ("THE SAME BARE COMMAND TWICE IN A FEW SECONDS IS ONE
// TAP"). Kept apart from the bot so it can be tested without starting it.
const REPEAT_WINDOW_MS = 5000;

export function isRepeatedBareCommand(
  seen: Map<number, { text: string; at: number }>,
  chatId: number,
  text: string,
  now: number,
): boolean {
  const bare = text.trim().toLowerCase().replace(/@[a-z0-9_]+$/, "");
  if (!/^\/[a-z]+$/.test(bare)) return false;
  const last = seen.get(chatId);
  seen.set(chatId, { text: bare, at: now });
  return last !== undefined && last.text === bare && now - last.at < REPEAT_WINDOW_MS;
}
