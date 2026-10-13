// End-to-end smoke test: everything a seller does, on a fresh throwaway shop,
// against the real database and the real model. Run: npm run eval:e2e
//
// Goes through the same entry points the Telegram bot uses (handleIncoming,
// handleAction), so it tests the product, not a helper. Telegram's own layer
// (phone registration, group refusal) needs a real Telegram chat and is not
// covered here.
import { existsSync } from "node:fs";
import { handleIncoming, handleAction } from "../src/messageHandler.js";
import type { Reply } from "../src/reply.js";
import { billHasItem, billCustomer } from "./billReading.js";

const SHOP = `e2e-${Date.now()}`;
let seq = 0;
let passed = 0;
const failures: string[] = [];

const msg = (text: string, messageId = `${SHOP}-${seq++}`) =>
  ({ platform: "telegram" as const, platformUserId: SHOP, displayName: "E2E", text, messageId });
const plain = (r: Reply) => r.text.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
const say = (text: string, messageId?: string) => handleIncoming(msg(text, messageId));
const tap = (action: string) => handleAction(msg(""), action);
const billNo = (r: Reply) => Number(plain(r).match(/Bill #(\d+)/)?.[1] ?? NaN);

function check(name: string, ok: boolean, reply?: Reply): void {
  // No reply may ever carry a technical error to a seller.
  const leaked = reply && /supabase|fetch failed|undefined|typeerror|pgrst|violates/i.test(plain(reply));
  if (ok && !leaked) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}${leaked ? "  (technical error shown)" : ""}`);
    if (reply) console.log(`        got: ${plain(reply).replace(/\s+/g, " ").slice(0, 220)}`);
  }
}

async function run(): Promise<void> {
  // --- Registration (the 3 steps after the Telegram phone share) ---------
  let r = await say("/start");
  check("start opens setup", /what do you sell/i.test(plain(r)), r);
  r = await tap("kind:restaurant");
  check("picking a kind asks the shop name", /shop called/i.test(plain(r)), r);
  r = await say("skip");
  check("shop name cannot be skipped", /shop name is needed/i.test(plain(r)), r);
  r = await say("E2E Cafe");
  check("shop name saved, prices asked", /E2E Cafe/.test(plain(r)) && /your prices/i.test(plain(r)), r);
  r = await say("paneer tikka 180\nbutter naan 40\nchai 15\nsamosa 20");
  check("price list finishes setup", /All set/i.test(plain(r)), r);

  // --- Billing ------------------------------------------------------------
  r = await say("Rahul 2 paneer tikka 3 butter naan");
  const rahul = billNo(r);
  check("order → bill with items, customer, total",
    billHasItem(r.text, "Paneer Tikka", 2) && billHasItem(r.text, "Butter Naan", 3) &&
    billCustomer(r.text) === "Rahul" && /TOTAL\s+₹480/.test(plain(r)), r);
  check("bill has Confirm / Mark Paid / PDF", (r.actions ?? []).length === 3, r);
  r = await say("add 2 chai");
  check("add an item to the open bill", billHasItem(r.text, "Chai", 2), r);
  r = await say("remove chai");
  check("remove an item", !billHasItem(r.text, "Chai", 2), r);
  r = await say("actually paneer tikka was 3");
  check("correct a quantity", billHasItem(r.text, "Paneer Tikka", 3), r);

  r = await say("/bill");
  check("bare /bill asks for the order with an example", Boolean(r.inputPlaceholder), r);
  r = await say("Priya 2 samosa 10% discount");
  const priya = billNo(r);
  check("tap-then-type order, with discount", billHasItem(r.text, "Samosa", 2) && /TOTAL\s+₹36/.test(plain(r)), r);

  r = await say("Amit 1,00,000 samosa");
  check("lakh-formatted quantity is one number", billHasItem(r.text, "Samosa", 100000), r);

  // /bill is canonical; /zbill is an alias of the SAME handler.
  r = await say("/bill Tanishk chai 1 samosa 2 10% discount");
  const viaBill = plain(r).replace(/Bill #\d+/, "Bill #N").replace(/\d+ \w+ \d{4}, [\d:]+ [ap]m/, "DATE");
  check("/bill with a name, items and a discount",
    billCustomer(r.text) === "Tanishk" && billHasItem(r.text, "Chai", 1) && billHasItem(r.text, "Samosa", 2) && /TOTAL\s+₹49\.50/.test(plain(r)), r);
  r = await say("/zbill Tanishk chai 1 samosa 2 10% discount");
  const viaZbill = plain(r).replace(/Bill #\d+/, "Bill #N").replace(/\d+ \w+ \d{4}, [\d:]+ [ap]m/, "DATE");
  check("/zbill still works and gives the identical bill", viaBill === viaZbill, r);
  r = await say("/bill@zbillingbot 1 chai");
  check("/bill@botname bills only the order", billHasItem(r.text, "Chai", 1) && !/zbillingbot/i.test(plain(r)), r);
  const dupBill = `${SHOP}-dupbill`;
  await say("/bill Neha 2 samosa", dupBill);
  r = await say("/bill Neha 2 samosa", dupBill);
  check("the same /bill message twice → one bill", /Already billed/.test(plain(r)), r);

  const dupId = `${SHOP}-dup`;
  await say("Neha 1 chai", dupId);
  r = await say("Neha 1 chai", dupId);
  check("same message twice → one bill", /Already billed/.test(plain(r)), r);

  r = await say("aaj ka bill 2 chai ₹10");
  check("order mentioning a day is still an order", billHasItem(r.text, "Chai", 2), r);

  // --- Payments -------------------------------------------------------------
  r = await tap(`confirm:${rahul}`);
  check("confirm shows today's figures", /Confirmed\. Today so far/.test(plain(r)), r);
  r = await say(`${rahul} paid 100`);
  check("part payment with bill number typed without #", /Recorded ₹100/.test(plain(r)) && /still due/.test(plain(r)), r);
  r = await say(`#${rahul} paid 1000`);
  check("overpayment is reported, not dropped", /more than the bill/.test(plain(r)), r);
  r = await say(`${priya} paid`);
  check("lone number that is a bill is asked about", /bill number or the amount/.test(plain(r)), r);
  r = await say("/add");
  r = await say("Rahul 2 samosa");
  check("after bare /add, an order is billed, not saved as a price", /Bill #/.test(plain(r)), r);

  // --- Prices ---------------------------------------------------------------
  r = await say("/add chai 20");
  check("changing a price asks first", /Change to/i.test(plain(r)), r);
  await say("/remove samosa");
  r = await say("/add samosa 25");
  check("re-adding a removed item", /samosa — ₹25/i.test(plain(r)), r);
  r = await say("1 samosa");
  check("re-added item can be billed at its new price", billHasItem(r.text, "Samosa", 1) && /₹25/.test(plain(r)), r);
  r = await say("rename butter naan to naan");
  check("rename an item", /Renamed/.test(plain(r)), r);

  // --- Reports --------------------------------------------------------------
  r = await say("sales");
  check("today's sales: Billed / Received / Due + Ledger PDF",
    /Billed/.test(plain(r)) && /Received/.test(plain(r)) && /Due/.test(plain(r)) &&
    (r.actions ?? []).some((a) => /Ledger PDF/.test(a.label)), r);
  for (const period of ["this week sales", "last week sales", "this month sales", "this year sales", "last 3 months"]) {
    r = await say(period);
    check(`report: ${period}`, /Billed|Nothing billed/.test(plain(r)), r);
  }
  r = await say("/bill");
  r = await say("2 months bill");
  check("report request inside /bill gives the report", /Last 2 months/.test(plain(r)), r);
  r = await say("/sales");
  check("/sales offers period buttons", (r.actions ?? []).length >= 9, r);
  r = await tap("sales:This month");
  check("tapping a period gives that report", /This month/.test(plain(r)), r);
  const ledgerAction = (r.actions ?? []).find((a) => /Ledger PDF/.test(a.label))?.action ?? "";
  r = await tap(ledgerAction);
  check("Ledger PDF is made", Boolean(r.document && existsSync(r.document.path)), r);

  r = await say("/customers");
  const rahulButton = (r.actions ?? []).find((a) => a.label === "Rahul");
  check("/customers lists customers", Boolean(rahulButton), r);
  r = await tap(rahulButton?.action ?? "");
  check("picking a customer asks for the period", /which period/i.test(plain(r)), r);
  r = await tap((r.actions ?? []).find((a) => a.label === "Today")?.action ?? "");
  check("customer report for a period", /RAHUL/.test(plain(r)) && /due/.test(plain(r)), r);
  r = await say("rahul bills this month");
  check("customer report typed", /RAHUL/.test(plain(r)), r);

  await say("Rahul Sharma 1 chai");
  r = await say("/customers");
  const rahuls = (r.actions ?? []).find((a) => a.label === "Rahul (2)");
  check("two customers with one first name are grouped", Boolean(rahuls), r);
  r = await tap(rahuls?.action ?? "");
  check("picking the first name asks which one, by surname",
    /Which Rahul/.test(plain(r)) && (r.actions ?? []).some((a) => a.label === "Rahul Sharma"), r);
  r = await tap((r.actions ?? []).find((a) => a.label === "Rahul Sharma")?.action ?? "");
  check("then the period", /Rahul Sharma — which period/.test(plain(r)), r);

  // --- Help & errors ----------------------------------------------------------
  r = await say("/help");
  check("help shows the manual topics", (r.actions ?? []).length === 7, r);
  r = await tap("help:pay");
  check("a manual topic opens", /Part:/.test(plain(r)), r);
  r = await say("/foo");
  check("unknown command explains itself", /don't know/i.test(plain(r)), r);
  r = await say("asdkjh qwe");
  check("gibberish gets a plain answer, no technical error", plain(r).length > 0, r);

  // --- A seller who skips ahead: /add first, orders before finishing setup -
  const other = `${SHOP}-skipahead`;
  const as = (text: string) =>
    handleIncoming({ platform: "telegram", platformUserId: other, displayName: "E2E2", text, messageId: `${other}-${seq++}` });
  await as("/add chai 15\nsamosa 20");
  r = await as("2 chai");
  check("order before setup is billed, name asked after",
    billHasItem(r.text, "Chai", 2) && (r.follow ?? []).some((f) => /shop called/i.test(f.text)), r);
  r = await as("do samosa");
  check("next order during setup is billed too, not blocked by the name question", billHasItem(r.text, "Samosa", 2), r);
  r = await as("ek chai aur do samosa");
  check("a Hindi-numeral order naming two products is billed, not saved as the shop name",
    billHasItem(r.text, "Chai", 1) && billHasItem(r.text, "Samosa", 2), r);
  r = await as("Chai Point");
  check("a shop name containing a product word is still a name", /Chai Point/.test(plain(r)), r);

  console.log(`\n${passed}/${passed + failures.length} passed  (test shop: ${SHOP})`);
  if (failures.length > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
