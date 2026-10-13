import type { Reply } from "./reply.js";

// The seller's manual, inside the chat: /help shows the short version and a
// button per topic; each topic says how to do it and what to check.
//
// EVERY instruction here was checked against what the bot really does.
// Two traps it deliberately steers around:
//   - "chai 20" alone is an ORDER for 20 chai, so prices are taught as /add.
//   - "change chai to 20" changes the QUANTITY, so it is never shown.
// Delivery is taught on its own line because on the same line as the items
// it is not yet recognised as a charge.
//
// Telegram HTML, one example per line, examples in <code> (tap to copy).

export const MANUAL_PREFIX = "help:";

interface Topic {
  id: string;
  label: string;
  text: string;
}

const TOPICS: Topic[] = [
  {
    id: "start",
    label: "🚀 Getting started",
    text: `<b>🚀 Getting started</b>

1. Add prices: tap /add
<code>paneer 220
chai 15</code>
2. Send an order:
<code>Rahul 2 samosa 1 chai</code>
3. Check it, tap ✅ Confirm`,
  },
  {
    id: "bill",
    label: "🧾 Make a bill",
    text: `<b>🧾 Make a bill</b>

Just type it, or tap /bill:
<code>Rahul 2 samosa 1 chai</code>

Discount: <code>Rahul 2 samosa 10% discount</code>
Own price: <code>Rahul 2 samosa ₹25 each</code>
Delivery, on its own line:
<code>delivery 30</code>

✔ Check name, items and total before Confirm.`,
  },
  {
    id: "fix",
    label: "✏️ Fix a bill",
    text: `<b>✏️ Fix a bill</b> (before Confirm)

<code>add 2 samosa</code>
<code>remove lassi</code>
<code>actually paneer was 3</code>
<code>this is Rahul</code>

✔ Fixes go to your latest open bill. Check its number.`,
  },
  {
    id: "pay",
    label: "💰 Payments",
    text: `<b>💰 Payments</b>

Full: tap 💰 <b>Paid</b> or <code>#1042 paid</code>
Part: <code>#1042 paid 200</code>
Dues: <code>who owes me</code>

✔ Only record money you actually received.`,
  },
  {
    id: "sales",
    label: "📊 Sales",
    text: `<b>📊 Sales</b>

Tap /sales and pick a period, or type:
<code>sales</code> · <code>september sales</code> · <code>last 3 months</code>

One customer: tap /customers or type <code>rahul bills</code>
Tap 📄 <b>Ledger PDF</b> for a full sheet.`,
  },
  {
    id: "prices",
    label: "🏷️ Prices",
    text: `<b>🏷️ Prices</b>

Add or change: <code>/add chai 20</code>
Remove: <code>/remove chai</code>
Rename: <code>rename panner to paneer</code>
See all: /prices

⚠ <code>chai 20</code> alone is an order for 20 chai.`,
  },
  {
    id: "trouble",
    label: "⚠️ Problems",
    text: `<b>⚠️ Problems</b>

Item not found → <code>/add chai 15</code>
Wrong item → <code>remove …</code> then <code>add …</code>
"Couldn't reach records" → wait a minute, check <code>open bills</code>, then resend.`,
  },
];

const backButton = { label: "↩️ All topics", action: `${MANUAL_PREFIX}home` };

export function manualHome(intro?: string): Reply {
  return {
    text:
      (intro ? `${intro}\n\n` : "") +
      `<b>Likho</b> — type the order, get the bill.\n\n` +
      `<code>Rahul 2 samosa 1 chai</code>\n\n` +
      `Help topics:`,
    parseMode: "HTML",
    actions: TOPICS.map((t) => ({ label: t.label, action: `${MANUAL_PREFIX}${t.id}` })),
  };
}

export function manualTopic(action: string): Reply | null {
  if (!action.startsWith(MANUAL_PREFIX)) return null;
  const id = action.slice(MANUAL_PREFIX.length);
  if (id === "home") return manualHome();
  const topic = TOPICS.find((t) => t.id === id);
  if (!topic) return manualHome();
  return { text: topic.text, parseMode: "HTML", actions: [backButton] };
}

export const MANUAL_TOPIC_IDS = TOPICS.map((t) => t.id);
export function manualTopicTexts(): string[] {
  return TOPICS.map((t) => t.text);
}
