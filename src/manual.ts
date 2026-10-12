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

<b>1. Add your prices</b>
Tap /add, then type one item and price per line:
<code>paneer 220
chai 15</code>
Just trying me out? Tap /start → ⚡ <b>Try a sample menu</b>.

<b>2. Make your first bill</b>
<code>Rahul 2 samosa 1 chai</code>

<b>3. Check it, then tap ✅ Confirm</b>

<b>✔ Check</b>
• /prices shows every item at the right price`,
  },
  {
    id: "bill",
    label: "🧾 Make a bill",
    text: `<b>🧾 Making a bill</b>

<b>Any of these works</b>
• Type it: <code>Rahul 2 samosa 1 chai</code>
• Tap /zbill, then type the order
• Forward the customer's message to me

<b>Write it like this</b>
Name first, then number before each item.
<code>Rahul 2 samosa 1 chai</code>

<b>Extras</b>
<code>Rahul 2 samosa 10% discount</code>
<code>Rahul 2 samosa ₹25 each</code> — this bill only
Delivery goes on its own line:
<code>Rahul 2 samosa
delivery 30</code>

<b>✔ Check before you tap Confirm</b>
• Customer name (missing? send <code>this is Rahul</code>)
• Every item and quantity
• Prices and the total
A confirmed bill can't be changed.

If I ask a question, just reply with the answer, like <code>2</code>.`,
  },
  {
    id: "fix",
    label: "✏️ Fix a bill",
    text: `<b>✏️ Fixing a bill</b>
Works until you tap ✅ Confirm.

<code>add 2 samosa</code>
<code>remove lassi</code>
<code>actually paneer was 3</code>
<code>this is Rahul</code> — set the name

<b>✔ Check</b>
• Changes go to your <b>latest unconfirmed bill from today</b>. The reply shows the bill number and name — make sure it's the right one.

<b>Made a wrong bill?</b>
Fix it with <code>remove …</code> and <code>add …</code> before you confirm. Every bill counts in your sales, even unconfirmed ones.`,
  },
  {
    id: "pay",
    label: "💰 Payments",
    text: `<b>💰 Payments</b>

<b>Paid in full</b>
Tap 💰 <b>Mark Paid</b> on the bill, or:
<code>#1042 paid</code>

<b>Part payment</b>
<code>#1042 paid 200</code>
If they pay more than the bill, I tell you the extra and don't record it.

<b>Who owes you</b>
<code>who owes me</code>
<code>rahul bills</code>

<b>✔ Check</b>
• Only record money you actually received — a customer saying "paid" is not proof
• The bill shows <b>Paid in full</b>, or <b>Paid ₹X · Due ₹Y</b>`,
  },
  {
    id: "sales",
    label: "📊 Sales",
    text: `<b>📊 Sales &amp; ledger</b>

Tap /sales and pick a period, or type one:
<code>sales</code> — today
<code>this week sales</code>
<code>september sales</code>
<code>last 3 months</code>
<code>2025 sales</code>

You get <b>Billed</b>, <b>Received</b> and <b>Due</b>. Tap 📄 <b>Ledger PDF</b> for every bill in a sheet.

<b>One customer</b>
Tap /customers and pick a person, or type:
<code>rahul bills</code>
<code>rahul bills this month</code>

<b>✔ Check at the end of the day</b>
• <code>open bills</code> — confirm each one or fix it. Every bill counts in your sales, so don't leave wrong ones.`,
  },
  {
    id: "prices",
    label: "🏷️ Prices",
    text: `<b>🏷️ Prices</b>

<b>Add or change</b>
<code>/add paneer 220</code>
If paneer already has a price, I ask before changing it. Old bills keep their old price.

<b>Remove / rename</b>
<code>/remove paneer</code>
<code>rename panner to paneer</code>

<b>See them</b>
/prices — also flags likely mistakes; tap to fix.

<b>⚠ Don't</b> send <code>chai 20</code> on its own to change a price — that's an order for 20 chai. Use <code>/add chai 20</code>.`,
  },
  {
    id: "trouble",
    label: "⚠️ Problems",
    text: `<b>⚠️ When something's off</b>

<b>"I couldn't find …"</b>
Check the spelling, or add it: <code>/add chai 15</code>

<b>I picked the wrong item</b>
Fix it before confirming: <code>remove …</code> then <code>add …</code>

<b>"I couldn't reach your records"</b>
Wait a minute and send it again. Before resending an order, check <code>open bills</code> so you don't bill it twice.

<b>No reply at all</b>
Wait a minute. If it still doesn't answer, tell the Likho team.`,
  },
];

const backButton = { label: "↩️ All topics", action: `${MANUAL_PREFIX}home` };

export function manualHome(intro?: string): Reply {
  return {
    text:
      (intro ? `${intro}\n\n` : "") +
      `<b>Likho</b> — type the order, I make the bill.\n\n` +
      `<code>Rahul 2 samosa 1 chai</code>\n\n` +
      `Pick a topic for step-by-step help and what to check:`,
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
