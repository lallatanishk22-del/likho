import { routeParseOrder } from "./router.js";
import { calculateBill } from "./calculator.js";
import { formatBill } from "./formatter.js";
import {
  getOrCreateBusinessForChannel, loadCatalog, upsertProduct, deactivateProduct,
  renameProduct, addAlias, setPendingResolution, takePendingResolution, getProductById,
  loadAliases, forgetAlias,
} from "./catalogStore.js";
import { suggestSpelling, findNearDuplicate } from "./spellingSuggest.js";
import {
  createBillSession,
  getCurrentDraft,
  finalizeBill,
  getTodaysSales,
  addItemToBill,
  removeItemFromBill,
  getBillByNo,
  getLatestBillForCustomer,
  setBillCustomer,
  recordPayment,
  setItemQuantity,
  getOpenBills,
  getSales,
  setBillDiscount,
  type StoredBill,
} from "./billStore.js";
import { buildCatalogIndex, findProduct, CatalogResolutionError } from "./catalog.js";
import { classifyIntent } from "./intent.js";
import { parseDiscount } from "./discount.js";
import { parseOrderExtras } from "./orderExtras.js";
import { auditPriceList } from "./priceListAudit.js";
import {
  handleCustomerHistory, handleOutstanding, handleStatement, handleSettle,
} from "./customerHandlers.js";
import { HELP, GREETING_REPLY, KNOWN_COMMANDS, splitCommands, type ParsedCommand } from "./commands.js";
import { suggestFromList } from "./nearName.js";
export { splitCommands, type ParsedCommand };
import type {
  Platform, ReplyAction, ReplyPhoto, ReplyDocument, Reply, IncomingMessage,
} from "./reply.js";

// Re-exported so existing callers keep one import site.
export type { Platform, ReplyAction, ReplyPhoto, ReplyDocument, Reply, IncomingMessage };
import {
  formatRupees, titleCase, renderStoredBill, billReply, billActions,
  historyRow, alignedBlock,
} from "./chatFormat.js";
import {
  encodeTemplate, decodeTemplate, encodeFix, decodeFix, encodeMeant, decodeMeant,
  encodePriceChange, decodePriceChange, encodeMerge, decodeMerge,
} from "./actionCodes.js";

// Re-exported so callers and tests keep one import site while the button
// encoding itself lives in actionCodes.ts.
export {
  encodeTemplate, decodeTemplate, encodeFix, decodeFix, encodeMeant, decodeMeant,
  encodePriceChange, decodePriceChange, encodeMerge, decodeMerge,
};
import {
  setPendingChoice, clearPendingChoice, resolvePendingChoice, type ChoiceOption,
} from "./pendingChoice.js";
import { parsePriceList, readsAsPriceList } from "./priceList.js";
import { formatBusinessDateTime, parseDateRange, stripDateExpressions } from "./businessDay.js";
import {
  loadBusinessProfile, setBillTemplate, setBusinessField, isEditableField, EDITABLE_FIELDS,
  loadOnboarding, setOnboardingStep, setBusinessKind, type OnboardingState,
} from "./businessProfile.js";
import {
  kindById, decodeKind, readBusinessKind, readShopName, looksLikeAnOrder,
  isSkip, welcomeQuestion, nameQuestion, pricesQuestion, pricesRetry, finishedMessage,
  orderBeforePricesQuestion,
  skippedMessage, SKIP_ACTION, FORMAT_ACTION, SHOP_ACTION, type BusinessKind,
} from "./onboarding.js";
import {
  CustomerAmbiguousError, findCustomer, findCustomerInMessage,
  loadCustomerHistory, listOutstanding, listCustomers,
  settleAllForCustomer, pendingSettlement, rememberCustomer, recallCustomer,
} from "./customerStore.js";
import { toBillData, toStatementData } from "./billRender.js";
import { renderBill } from "./templates/index.js";
import { renderStatement } from "./templates/statement.js";
import { htmlToPdf, PdfUnavailableError } from "./billPdf.js";
import { TEMPLATE_IDS, TEMPLATE_LABELS, asTemplateId } from "./billData.js";
import { renderPreviews, previewData } from "./billPreviews.js";
import { renderBillText, needsMonospace, escapeHtml, TEXT_STYLES, type TextStyle } from "./billText.js";
import { SAMPLE_BILL } from "./billSamples.js";

// Platform-independent command routing. Telegram polling (telegramBot.ts)
// and the HTTP API used by n8n (apiServer.ts) both call handleIncoming(),
// so every channel gets identical behaviour and the logic cannot drift
// between them. Nothing here knows what Telegram is.

async function handleAdd(businessId: string, args: string): Promise<Reply> {
  const { entries, unreadable } = parsePriceList(args);

  if (entries.length === 0 && unreadable.length === 0) {
    return {
      text:
        "Tell me your rates. Any of these work:\n" +
        "  /add paneer 220\n" +
        "  /add 220 paneer\n" +
        "  /add paneer 220, lassi 80\n\n" +
        "Or one per line.",
    };
  }

  // Read the price list BEFORE saving, so both a price change and a
  // near-duplicate can be judged against what was already there.
  const before = await loadCatalog(businessId);
  const existingByName = new Map(
    before.products.map((p) => [p.name.toLowerCase(), p] as const),
  );

  const created: typeof entries = [];
  const unchanged: typeof entries = [];
  const priceChanges: { name: string; from: number; to: number }[] = [];

  for (const entry of entries) {
    const existing = existingByName.get(entry.name.toLowerCase());
    if (!existing) {
      created.push(entry);
    } else if (existing.price === entry.price) {
      unchanged.push(entry);
    } else {
      priceChanges.push({ name: existing.name, from: existing.price, to: entry.price });
    }
  }

  // Only genuinely new items are written now. A price change waits for a tap.
  for (const entry of created) {
    await upsertProduct(businessId, entry.name, entry.price);
  }

  const parts: string[] = [];
  const actions: ReplyAction[] = [];
  const choices: ChoiceOption[] = [];

  if (created.length > 0) {
    parts.push(
      `Saved ${created.length} item(s):\n` +
        created.map((e) => `  ${e.name} — ${formatRupees(e.price)}`).join("\n"),
    );
  }

  if (unchanged.length > 0) {
    parts.push(
      `Already at that price, nothing changed:\n` +
        unchanged.map((e) => `  ${e.name} — ${formatRupees(e.price)}`).join("\n"),
    );
  }

  // Price changes come first in the actions list: it is the only prompt
  // here that is still waiting on the seller before anything is saved.
  for (const change of priceChanges) {
    const action = encodePriceChange(change.name, change.to);
    const direction = change.to > change.from ? "up" : "down";
    parts.push(
      `"${change.name}" is already ${formatRupees(change.from)}.\n\n` +
        `Change it ${direction} to ${formatRupees(change.to)}? This is what every ` +
        `future bill will charge. Bills already made keep ${formatRupees(change.from)}.` +
        (action ? "" : `\n\nTo change it:  /add ${change.name} ${change.to}`),
    );
    if (action) {
      actions.push({
        label: `\u{1f4b0} ${change.name}: ${formatRupees(change.from)} → ${formatRupees(change.to)}`,
        action,
      });
    }
  }

  // A duplicate in the seller's OWN list matters more than a dictionary
  // suggestion, and the two would otherwise both fire on the same item.
  // Only newly created names can be duplicates - a price change is by
  // definition an item that already exists under that exact name.
  const duplicates = created
    .map((e) => findNearDuplicate(e.name, before.products))
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const duplicateNames = new Set(duplicates.map((d) => d.added.toLowerCase()));

  for (const d of duplicates) {
    // BOTH names get a button. Offering only one is not a choice — the
    // seller was shown "Keep only caku" with no way to keep "cake", which
    // was very likely the answer they wanted.
    parts.push(
      `You already have "${d.existing}" at ${formatRupees(d.existingPrice)}, ` +
        `which looks like the same thing as "${d.added}".\n\n` +
        `Different items? Keep both. Otherwise pick one — two names split ` +
        `your sales, and a misspelled order can't be priced.`,
    );

    const keepAdded = encodeMerge(d.existing);
    const keepExisting = encodeMerge(d.added);
    if (keepAdded) {
      actions.push({ label: `Keep "${d.added}"`, action: keepAdded });
      choices.push({ label: `Keep "${d.added}"`, action: keepAdded, value: d.added });
    }
    if (keepExisting) {
      actions.push({ label: `Keep "${d.existing}"`, action: keepExisting });
      choices.push({ label: `Keep "${d.existing}"`, action: keepExisting, value: d.existing });
    }
  }

  // Flag likely misspellings, but SAVE WHAT WAS TYPED. The name goes on
  // every bill the customer sees, so a typo here is permanent and worth
  // catching — but it is the seller's menu, and a shop genuinely called
  // "Panner Corner" must not be overruled by a spellchecker.
  const suggestions = created
    .map((e) => suggestSpelling(e.name))
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .filter((x) => !duplicateNames.has(x.typed.toLowerCase()));

  if (suggestions.length > 0) {
    const fixable = suggestions.filter((x) => encodeFix(x.typed, x.suggested) !== null);
    parts.push(
      `${suggestions.length === 1 ? "One name looks" : "Some names look"} like a spelling slip:\n` +
        suggestions.map((x) => `  "${x.typed}" → "${x.suggested}"?`).join("\n") +
        `\n\nThis is what prints on the customer's bill.` +
        (fixable.length === suggestions.length
          ? `\nTap to fix, or ignore it if the spelling is deliberate.`
          : `\n\nTo change one:  rename ${suggestions[0]!.typed} to ${suggestions[0]!.suggested}`),
    );
    for (const x of fixable) {
      actions.push({
        label: `✏️ ${x.typed} → ${x.suggested}`,
        action: encodeFix(x.typed, x.suggested)!,
      });
    }
  }

  if (unreadable.length > 0) {
    // A NAME WITH NO PRICE IS NOT A FAILURE — IT IS A QUESTION.
    //
    // "/add paner" came back "I couldn't find a price for: paner", which
    // is true and useless. The seller already HAS paneer at Rs 100; the
    // one thing worth saying is exactly that. Checking costs one lookup
    // against data already loaded.
    const index = buildCatalogIndex(before);
    for (const fragment of unreadable) {
      // A BARE NUMBER IS NOT A PRODUCT NAME. "3 thali 150" once left "150"
      // behind and the reply asked for the price of "150", offering to
      // save it as "150 100". Whatever went wrong on that line, the answer
      // is never to name a product after a number.
      if (/^\s*(?:₹|rs\.?)?\d+(?:\.\d{1,2})?\s*$/i.test(fragment)) {
        parts.push(
          `I couldn't place ${formatRupees(Number(fragment.replace(/[^\d.]/g, "")))} ` +
            `— a price needs a name beside it.\n\nSend it as:  paneer ${fragment.replace(/[^\d.]/g, "")}`,
        );
        continue;
      }

      const existing = findProduct(fragment, index);
      if (existing && existing !== "ambiguous") {
        const sameSpelling = existing.product.name.toLowerCase() === fragment.toLowerCase();
        parts.push(
          sameSpelling
            ? `You already have ${titleCase(existing.product.name)} at ${formatRupees(existing.product.price)}.\n\n` +
              `To change it, send:  ${existing.product.name} 120`
            : `"${fragment}" \u2014 you already have ${titleCase(existing.product.name)} at ${formatRupees(existing.product.price)}.\n\n` +
              `Order it however you spell it; the bill will say ${titleCase(existing.product.name)}.\n` +
              `To change the price, send:  ${existing.product.name} 120`,
        );
        continue;
      }

      // Not in the list. If it looks like a known dish misspelled, offer
      // the spelling now, BEFORE it is saved wrong and prints on a bill.
      const spelling = suggestSpelling(fragment);
      parts.push(
        spelling
          ? `I don't have "${fragment}" yet \u2014 did you mean ${titleCase(spelling.suggested)}?\n\n` +
            `Send it with a price:  ${spelling.suggested} 100`
          : `I don't have "${fragment}" yet, and I need its price.\n\n` +
            `Send it as:  ${fragment} 100`,
      );
    }
  }

  return {
    text: parts.join("\n\n"),
    actions: actions.length > 0 ? actions : undefined,
    choices: choices.length > 0 ? choices : undefined,
  };
}

// Renaming keeps the product's id, so bills that already used it stay
// linked and their price snapshots are untouched. Only the name that
// prints on FUTURE bills changes.
async function handleRename(businessId: string, args: string): Promise<Reply> {
  const match = args.match(/^(.+?)\s+(?:to|as|->|\u2192)\s+(.+)$/i);
  if (!match) {
    return { text: 'Use: rename panner to paneer' };
  }
  const from = match[1]!.trim();
  const to = match[2]!.trim();
  if (from.length === 0 || to.length === 0) {
    return { text: 'Use: rename panner to paneer' };
  }

  const result = await renameProduct(businessId, from, to);
  if (result === "not_found") {
    return { text: `"${from}" isn't in your price list. Check /prices.` };
  }
  if (result === "target_exists") {
    return {
      text:
        `You already have "${to}" in your price list.\n\n` +
        `Remove one of them first:  /remove ${from}`,
    };
  }
  return { text: `Renamed "${from}" to "${to}". Past bills keep the name they were made with.` };
}

// What this business has taught Likho. A learned alias silently changes
// how future orders are priced, so it must be visible and removable — a
// wrong one would misprice quietly forever.
async function handleLearned(businessId: string): Promise<Reply> {
  const aliases = await loadAliases(businessId);
  if (aliases.length === 0) {
    return {
      text:
        "I haven't learned any words yet.\n\n" +
        "When an order name could mean two things, I'll ask once and remember your answer.",
    };
  }
  const lines = aliases.map((a) => `  "${a.alias}" \u2192 ${titleCase(a.productName)}`);
  return {
    text:
      `Words you've taught me:\n\n${lines.join("\n")}\n\n` +
      `Wrong one? Say:  forget ${aliases[0]!.alias}`,
  };
}

async function handleForget(businessId: string, args: string): Promise<Reply> {
  const word = args.trim();
  if (word.length === 0) return { text: "Use: forget paner" };
  const removed = await forgetAlias(businessId, word);
  return {
    text: removed
      ? `Forgotten. I'll ask again next time "${word}" comes up.`
      : `I haven't learned "${word}".`,
  };
}

// --- Bill style ----------------------------------------------------------

// Shows all six styles as ACTUAL RENDERED BILLS, using the seller's own
// shop name and their own last order where one exists. Six names would ask
// them to imagine six layouts; six pictures ask them to point at one.
async function handleBillFormat(
  businessId: string,
  onSlowWork?: () => Promise<void>,
): Promise<Reply> {
  await onSlowWork?.();

  const business = await loadBusinessProfile(businessId);
  const lastBill = await getCurrentDraft(businessId);

  let previews;
  try {
    previews = await renderPreviews(previewData(business, lastBill));
  } catch (err) {
    if (err instanceof PdfUnavailableError) {
      // Without a browser the pictures cannot be made, but the CHOICE must
      // still work — a seller should never be blocked from picking a style.
      return {
        text:
          `Choose your bill style:\n\n` +
          TEMPLATE_IDS.map(
            (id) => `  ${TEMPLATE_LABELS[id].name} \u2014 ${TEMPLATE_LABELS[id].forWho}`,
          ).join("\n") +
          `\n\nCurrently: ${TEMPLATE_LABELS[asTemplateId(business.billTemplate)].name}`,
        actions: TEMPLATE_IDS.map((id) => ({
          label: TEMPLATE_LABELS[id].name,
          action: encodeTemplate(id),
        })),
      };
    }
    throw err;
  }

  const current = asTemplateId(business.billTemplate);
  return {
    text:
      `How do you want your bill to look?\n\n` +
      previews
        .map(
          (p, i) =>
            `${i + 1}. ${p.label}${p.id === current ? "  \u2713 using this" : ""}\n     ${p.forWho}`,
        )
        .join("\n") +
      `\n\nTap one to use it.`,
    photos: previews.map((p, i) => ({ path: p.pngPath, caption: `${i + 1}. ${p.label}` })),
    actions: previews.map((p, i) => ({
      label: `${i + 1}. ${p.label}${p.id === current ? " \u2713" : ""}`,
      action: encodeTemplate(p.id),
    })),
  };
}

// Renders a stored bill through the chosen template and returns a PDF.
// The bill already exists as a record; this only draws it.
async function handleBillPdf(
  businessId: string,
  billNo: number | null,
  customer: string | null = null,
): Promise<Reply> {
  const bill = await resolveBill(businessId, billNo, customer);
  if (!bill) {
    return { text: noBillFor(customer, "No bill to export. Send me an order and I'll make one.") };
  }

  const business = await loadBusinessProfile(businessId);
  const data = toBillData(bill, business);
  const html = renderBill(data, business.billTemplate);

  try {
    const path = await htmlToPdf(html, `bill-${bill.session.bill_no}`);
    return {
      text: "",
      document: {
        path,
        caption: `Bill #${bill.session.bill_no} \u00b7 ${formatRupees(Number(bill.session.total))}`,
      },
    };
  } catch (err) {
    if (err instanceof PdfUnavailableError) {
      return {
        text:
          "I can't make PDFs on this machine yet \u2014 no Chrome found.\n" +
          "The bill above is still the record.",
      };
    }
    throw err;
  }
}

// Business details that appear at the top of every bill.
async function handleBusinessInfo(businessId: string, args: string): Promise<Reply> {
  const match = args.match(/^(\w+)\s*(?:=|:|\s)\s*([\s\S]*)$/);
  const business = await loadBusinessProfile(businessId);

  if (!match || !isEditableField(match[1]!)) {
    const lines = [
      `Name:     ${business.name}`,
      `Phone:    ${business.phone ?? "\u2014"}`,
      `Address:  ${business.address ?? "\u2014"}`,
      `GSTIN:    ${business.gstin ?? "\u2014"}`,
      `UPI:      ${business.upiId ?? "\u2014"}`,
      `Note:     ${business.footerNote ?? "\u2014"}`,
    ];
    return {
      text:
        `This is what appears on your bills:\n\n${lines.join("\n")}\n\n` +
        `Change any of them:\n  shop phone 98200 41122\n  shop gstin 27AABCS1429B1ZX\n\n` +
        `Fields: ${EDITABLE_FIELDS.join(", ")}`,
    };
  }

  await setBusinessField(businessId, match[1]!, match[2]!);
  const updated = await loadBusinessProfile(businessId);
  const shown =
    match[2]!.trim().length > 0 ? match[2]!.trim() : "(cleared)";
  return {
    text: `Updated. ${match[1]!.toLowerCase()}: ${shown}\n\nIt'll show on your next bill. Say "bill format" to see it.`,
    ...(updated ? {} : {}),
  };
}

// --- Setup ---------------------------------------------------------------
//
// onboarding.ts decides WHAT to ask and how to read an answer; this is the
// half that touches the database. See that file for why these three
// questions and no more.

async function applyKind(businessId: string, kind: BusinessKind): Promise<Reply> {
  await setBusinessKind(businessId, kind.id, kind.template);
  await setOnboardingStep(businessId, "name");
  return nameQuestion(kind);
}

async function handleRestartSetup(businessId: string): Promise<Reply> {
  await setOnboardingStep(businessId, "kind");
  return welcomeQuestion(false);
}

async function handleSkipSetup(businessId: string): Promise<Reply> {
  const state = await loadOnboarding(businessId);
  await setOnboardingStep(businessId, "done");
  return { text: skippedMessage(state.step) };
}

// Runs INSTEAD of the normal intent layer while setup is unfinished. A new
// seller has no prices, so every other path could only tell them what is
// missing; asking three questions first is the shorter route to their
// first real bill.
async function handleOnboarding(
  businessId: string,
  state: OnboardingState,
  incoming: IncomingMessage,
  text: string,
  sourceMessageId: string | null,
): Promise<Reply> {
  const kind = kindById(state.kindId);
  const [first] = splitCommands(text);

  // Only these two commands are honoured mid-setup. Everything else is
  // read as an answer to the current question, which is what lets
  // "/add paneer 220" work as the reply to the price question.
  if (first?.command === "/help") return { text: HELP };
  if (first?.command === "/setup") return await handleRestartSetup(businessId);

  if (isSkip(text)) {
    await setOnboardingStep(businessId, "done");
    return { text: skippedMessage(state.step) };
  }

  switch (state.step) {
    case "kind": {
      const picked = readBusinessKind(text);
      if (picked) return await applyKind(businessId, picked);

      // A seller who opens the bot and immediately types an order wants a
      // bill, not a questionnaire. Being made to finish setup first is how
      // this loses to a notebook.
      if (looksLikeAnOrder(text)) {
        const catalog = await loadCatalog(businessId);
        if (catalog.products.length > 0) {
          await setOnboardingStep(businessId, "done");
          return await handleOrder(businessId, text, sourceMessageId, incoming.onSlowWork);
        }
        // Nothing priced means the order genuinely cannot be billed. Skip
        // the remaining questions down to the only one that unblocks it.
        await setOnboardingStep(businessId, "prices");
        return orderBeforePricesQuestion(kind);
      }

      const opening =
        first?.command === "/start" ||
        text.length === 0 ||
        classifyIntent(text).name === "greeting";
      return welcomeQuestion(!opening);
    }

    case "name": {
      const read = readShopName(text);
      if ("problem" in read) return nameQuestion(kind, read.problem);
      await setBusinessField(businessId, "name", read.name);
      await setOnboardingStep(businessId, "prices");
      return pricesQuestion(kind, read.name);
    }

    case "prices": {
      // GUARD 1 — AN ORDER IS NOT A PRICE LIST.
      //
      // Without this, "ria bhanushali 2 paneer 1 chai" was SAVED AS A
      // PRODUCT called "ria bhanushali" at Rs 2. A real order silently
      // became a price, the bill never existed, and every later bill
      // number shifted. The kind step already had this guard; the prices
      // step did not.
      if (looksLikeAnOrder(text)) {
        const catalog = await loadCatalog(businessId);
        if (catalog.products.length > 0) {
          await setOnboardingStep(businessId, "done");
          return await handleOrder(businessId, text, sourceMessageId, incoming.onSlowWork);
        }
      }

      // GUARD 2 — NEITHER IS ANY OTHER INSTRUCTION.
      //
      // "shop upi shree@okaxis" was saved as a product named
      // "shop upi shree@okaxis". Setup asks a question; it does not get to
      // reinterpret everything the seller says while it waits.
      const otherIntent = classifyIntent(text).name;
      if (otherIntent !== "order" && otherIntent !== "greeting") {
        return await runIntent(businessId, incoming, text, sourceMessageId);
      }

      // "/add paneer 220" is the right answer, typed with a command the
      // seller may have seen in /help. Strip it rather than reject it.
      const args = text.replace(/^\/add\s*/i, "").trim();

      // Setup only finishes if this message actually saved something. The
      // count is compared rather than trusting the reply text, because
      // handleAdd deliberately reports partial success.
      const before = await loadCatalog(businessId);
      const saved = await handleAdd(businessId, args);
      const after = await loadCatalog(businessId);

      if (after.products.length <= before.products.length) {
        const said = saved.text.trim();
        return {
          text: said.length > 0 ? `${said}\n\n${pricesRetry(kind)}` : pricesRetry(kind),
          actions: [
            ...(saved.actions ?? []),
            { label: "Skip \u2014 I'll add them later", action: SKIP_ACTION },
          ],
        };
      }

      await setOnboardingStep(businessId, "done");
      const done = finishedMessage(kind, state.name, after.products.map((p) => p.name));
      // handleAdd may have flagged a typo or a near-duplicate. Those taps
      // are about the prices just saved, so they come first.
      return {
        text: `${saved.text}\n\n${done.text}`,
        actions: [...(saved.actions ?? []), ...(done.actions ?? [])].slice(0, 6),
      };
    }

    default:
      return { text: HELP };
  }
}

// Shows each text-bill style as a real chat bubble, using the seller's own
// last order where they have one. The point is to see it at phone width in
// the actual app — a description of "aligned columns" tells you nothing
// about whether the columns line up on YOUR screen.
async function handleMock(businessId: string): Promise<Reply> {
  const business = await loadBusinessProfile(businessId);
  const lastBill = await getCurrentDraft(businessId);
  const data = lastBill && lastBill.items.length > 0
    ? toBillData(lastBill, business)
    : { ...SAMPLE_BILL, business: { ...SAMPLE_BILL.business, name: business.name }, taxes: [], total: 400, subtotal: 400, amountPaid: 400 };

  const bubbles: Reply[] = TEXT_STYLES.map((style) => {
    const rendered = renderBillText(data, style.id);
    const label = `${style.name.toUpperCase()} — ${style.note}`;
    return needsMonospace(style.id)
      ? { text: `${label}\n<pre>${escapeHtml(rendered)}</pre>`, parseMode: "HTML" as const }
      : { text: `${label}\n\n${rendered}` };
  });

  const [first, ...rest] = bubbles;
  return {
    ...first!,
    follow: [
      ...rest,
      {
        text:
          "Which one? Tap to use it for every bill from now on.\n\n" +
          "PLAIN is what you have today: the columns are padded, but Telegram " +
          "draws them in a proportional font so the padding is ignored.",
        actions: TEXT_STYLES.map((style) => ({
          label: style.name,
          action: `txt:${style.id}`,
        })),
      },
    ],
  };
}

// --- Customer history ----------------------------------------------------
//
// RULE: reading history NEVER writes. It cannot create a customer, open a
// draft, or change a total. That is what makes a bare name safe to type.

async function mentionsKnownProduct(businessId: string, text: string): Promise<boolean> {
  const catalog = await loadCatalog(businessId);
  if (catalog.products.length === 0) return false;
  const index = buildCatalogIndex(catalog);

  const words = text.toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
  for (const size of [3, 2, 1]) {
    for (let i = 0; i + size <= words.length; i++) {
      const found = findProduct(words.slice(i, i + size).join(" "), index);
      if (found && found !== "ambiguous") return true;
    }
  }
  return false;
}

// The honest reply when a message is not an order and names nobody known.
async function notAnOrderReply(businessId: string, text: string): Promise<Reply> {
  const customers = await listCustomers(businessId);
  const looksLikeAName = /^[\p{L}\s'’.]+$/u.test(text.trim()) && text.trim().split(/\s+/).length <= 4;

  if (looksLikeAName && customers.length > 0) {
    return {
      text:
        `I don't have that customer yet.\n\n` +
        `They'll appear here after their first bill \u2014 send one like:\n` +
        `  Pooja 2 chai\n\n` +
        `Customers I do have:\n${customers.slice(0, 10).map((c) => `  ${titleCase(c.name)}`).join("\n")}`,
    };
  }

  return {
    text:
      "I couldn't find an order in that — a bill needs quantities.\n\n" +
      "Send it like:\n  Ravi 2 paneer 1 chai\n\n" +
      "Or ask me about someone:\n  ravi\n  who hasn't paid\n  sales",
  };
}

// Discounting a bill that already exists. The percentage came from the
// deterministic parser; calculator.ts turns it into money.
async function handleSetDiscount(
  businessId: string,
  percent: number,
  text: string,
): Promise<Reply> {
  const named = await findCustomerInMessage(businessId, stripDateExpressions(text));
  const customer = named && named !== "ambiguous" ? named.name : null;

  const bill = await resolveBill(businessId, classifyIntent(text).billNo, customer);
  if (!bill) {
    return { text: "No open bill to discount. Send me an order first." };
  }
  if (bill.session.status === "finalized") {
    return {
      text:
        `Bill #${bill.session.bill_no} is already confirmed, so its total is fixed.\n\n` +
        `Discount the next one, or start a new bill.`,
    };
  }

  const updated = await setBillDiscount(bill.session.id, percent);
  return billReply(updated, `${percent}% off applied.`);
}

async function handleKeepOnly(businessId: string, name: string): Promise<Reply> {
  const wanted = name.trim();
  if (wanted.length === 0) return { text: 'Keep which one? Say: keep only cake' };

  const catalog = await loadCatalog(businessId);
  const index = buildCatalogIndex(catalog);
  const found = findProduct(wanted, index);
  if (!found || found === "ambiguous") {
    return { text: `I don't have "${wanted}" in your price list.` };
  }
  const keep = found.product;

  // Everything that looks like the same item, except the one being kept.
  const rivals = catalog.products.filter(
    (p) =>
      p.id !== keep.id &&
      findNearDuplicate(p.name, [{ name: keep.name, price: keep.price }]) !== null,
  );

  if (rivals.length === 0) {
    return { text: `${titleCase(keep.name)} at ${formatRupees(keep.price)} — nothing else looks like it.` };
  }

  for (const rival of rivals) await deactivateProduct(businessId, rival.name);

  return {
    text:
      `Kept ${titleCase(keep.name)} at ${formatRupees(keep.price)}.\n` +
      `Dropped ${rivals.map((r) => `"${r.name}"`).join(", ")}.\n\n` +
      `Past bills keep the name and price they were made with.`,
  };
}

async function handlePrices(businessId: string): Promise<Reply> {
  const catalog = await loadCatalog(businessId);
  if (catalog.products.length === 0) {
    return { text: "Your price list is empty. Add items with:\n  /add paneer 120" };
  }

  const sorted = catalog.products.slice().sort((a, b) => a.name.localeCompare(b.name));
  const width = Math.max(...sorted.map((p) => titleCase(p.name).length));
  const rows = sorted.map(
    (p) => `${titleCase(p.name).padEnd(width)}  ${formatRupees(p.price).padStart(8)}`,
  );

  const problems = auditPriceList(sorted.map((p) => ({ name: p.name, price: p.price })));
  const parts = [`<pre>${escapeHtml([`YOUR PRICES`, "", ...rows].join("\n"))}</pre>\n`];
  const actions: ReplyAction[] = [];

  if (problems.length > 0) {
    const notes = problems.map((p) => {
      if (p.kind === "duplicate") {
        return `  "${p.name}" ${formatRupees(p.price)} and "${p.other}" ${formatRupees(p.otherPrice)} look like the same item`;
      }
      if (p.kind === "bad_name") {
        return `  "${p.name}" looks like a bad entry — did you mean "${p.suggested}"?`;
      }
      return `  "${p.name}" → "${p.suggested}"?`;
    });

    parts.push(
      escapeHtml(
        `${problems.length} thing${problems.length === 1 ? "" : "s"} worth fixing — ` +
          `${problems.length === 1 ? "it prints" : "these print"} on your customers' bills:\n` +
          notes.join("\n"),
      ),
    );

    // At most four, so the keyboard stays readable. The rest surface once
    // these are dealt with.
    for (const problem of problems.slice(0, 4)) {
      if (problem.kind === "duplicate") {
        // BOTH names get a button, better-spelled one first. Offering only
        // one is not a choice, and the seller may well want the other.
        const nameIsTypo = suggestSpelling(problem.name) !== null;
        const otherIsTypo = suggestSpelling(problem.other) !== null;
        const first =
          nameIsTypo !== otherIsTypo
            ? (nameIsTypo ? problem.other : problem.name)
            : (problem.price >= problem.otherPrice ? problem.name : problem.other);
        const second = first === problem.name ? problem.other : problem.name;

        const keepFirst = encodeMerge(second);
        const keepSecond = encodeMerge(first);
        if (keepFirst) actions.push({ label: `Keep "${first}"`, action: keepFirst });
        if (keepSecond) actions.push({ label: `Keep "${second}"`, action: keepSecond });
      } else {
        const action = encodeFix(problem.name, problem.suggested);
        if (action) actions.push({ label: `✏️ ${problem.name} → ${problem.suggested}`, action });
      }
    }
  }

  return {
    text: parts.join("\n"),
    parseMode: "HTML" as const,
    actions: actions.length > 0 ? actions : undefined,
  };
}

async function handleRemove(businessId: string, args: string): Promise<string> {
  const name = args.trim();
  if (name.length === 0) return "Use: /remove <item>\nExample: /remove lassi";
  const removed = await deactivateProduct(businessId, name);
  return removed ? `Removed: ${name}` : `"${name}" isn't in your price list.`;
}

// The core flow: order text -> existing pipeline (now catalog-aware) -> bill.
async function handleOrder(
  businessId: string,
  text: string,
  sourceMessageId: string | null,
  onSlowWork?: () => Promise<void>,
): Promise<Reply> {
  await onSlowWork?.();
  const catalog = await loadCatalog(businessId);

  if (catalog.products.length === 0) {
    // With nothing priced, "paneer 220" is the seller answering the very
    // message that asked for their rates — not an order for one paneer at
    // ₹220. Telling them to send rates and then billing those rates as an
    // order is a loop with no way out of it.
    if (readsAsPriceList(text)) return await handleAdd(businessId, text);

    return {
      text:
        "Your price list is empty, so I can only bill orders that include prices.\n\n" +
        "Send me your rates first, one per line:\n  paneer 120\n  samosa 20\n\n" +
        "Or state the price in the order itself:\n  2 paneer 120",
    };
  }

  // The discount is read here and taken OUT of the message. The model
  // could not handle the extra number — see discount.ts — and it does not
  // need to: a percentage is exact, so code reads it and code applies it.
  // Everything that is NOT an item comes out first — a delivery charge, a
  // payment mode, an explicit customer line. Sent whole, a real order was
  // refused because "30" (delivery) belonged to nothing the trust layer
  // knew about. See orderExtras.ts.
  const extras = parseOrderExtras(text);
  const { percent: statedDiscount, rest: orderText } = parseDiscount(extras.rest);

  try {
    const { parsed } = await routeParseOrder(orderText, { catalog });
    const bill = calculateBill(
      parsed.items,
      statedDiscount ?? parsed.discountPercent ?? 0,
      extras.charges,
    );
    // Persist as a draft so the bill survives the reply and can be looked
    // at, edited and updated later. This is what makes it a transaction
    // rather than a one-off message.
    // An explicit "customer Rahul" line wins over whatever the model
    // inferred — the seller said it outright.
    const withCustomer = extras.customer ? { ...parsed, customer: extras.customer } : parsed;
    const stored = await createBillSession(
      businessId, withCustomer, bill, sourceMessageId, extras.paymentMethod,
    );
    // An anonymous bill is a hole in the business's memory: it can never
    // be looked up by name, chased for payment, or counted toward what a
    // customer owes. Asked ONCE, here, rather than on every later render —
    // a nudge that repeats becomes noise the seller learns to ignore.
    const nudge = stored.session.customer_ref
      ? ""
      : "\n\nWho is this for? Say: this is Ravi";
    return billReply(stored, nudge.trim().length > 0 ? nudge.trim() : undefined);
  } catch (err) {
    // An ambiguous name is a question with a known set of answers. Offer
    // them, and remember the message so the answer can re-run it — being
    // told "be more specific" about your own price list is a dead end.
    if (err instanceof CatalogResolutionError) {
      const ambiguous = err.unresolved.find(
        (u) => u.reason === "ambiguous_in_catalog" && (u.candidates?.length ?? 0) > 0,
      );
      if (ambiguous) {
        await setPendingResolution(businessId, text, ambiguous.name);
        return {
          text: err.message,
          actions: ambiguous.candidates!.slice(0, 4).map((c) => ({
            label: `${titleCase(c.name)} \u2014 ${formatRupees(c.price)}`,
            action: encodeMeant(c.id),
          })),
        };
      }
    }
    return { text: (err as Error).message };
  }
}

// Manual edit. Parsed deterministically — NO model, no trust layer: the
// seller is stating exactly what they want, so there is nothing to infer
// and nothing to approve. This is a different path from Check Updates,
// where the model PROPOSES changes that the seller must confirm.
//
//   /plus 2 chutney        price from the seller's list
//   /plus 2 chutney 15     price stated explicitly, wins
async function handleAddItem(businessId: string, args: string): Promise<Reply> {
  const draft = await getCurrentDraft(businessId);
  if (!draft) return { text: "No open bill yet. Send me an order and I'll make one." };

  const tokens = args.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length < 2) {
    return { text: "Tell me what to add, like:\n  add 2 chutney" };
  }

  const quantity = Number(tokens[0]);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { text: `"${tokens[0]}" isn't a quantity. Try: add 2 chutney` };
  }

  // A trailing number is an explicit price for this bill only.
  const maybePrice = Number(tokens[tokens.length - 1]);
  const hasStatedPrice = tokens.length > 2 && Number.isFinite(maybePrice) && maybePrice > 0;
  const rawName = (hasStatedPrice ? tokens.slice(1, -1) : tokens.slice(1)).join(" ");

  if (rawName.length === 0) return { text: "Which item? Try: add 2 chutney" };

  let unitPrice: number;
  let productId: string | null = null;
  let priceSource: "stated" | "catalog" | "manual";
  let name = rawName;

  if (hasStatedPrice) {
    unitPrice = maybePrice;
    priceSource = "manual";
  } else {
    // Same price store and the SAME tiered matching the order path uses,
    // so "add 2 lasssi" behaves identically to billing "2 lasssi".
    const catalog = await loadCatalog(businessId);
    const index = buildCatalogIndex(catalog);
    const found = findProduct(name, index);
    if (found === "ambiguous") {
      return { text: `"${name}" matches more than one item in your price list. Which one?` };
    }
    const match = found?.product ?? null;
    if (!match) {
      return { text: `I don't have a price for "${name}".\n\nSend me the rate:  ${name} 50\nOr state it here:  add ${quantity} ${name} 50` };
    }
    unitPrice = match.price;
    productId = match.id;
    priceSource = "catalog";
    // Canonical name on the bill, so a near-match is visible.
    name = match.name;
  }

  const updated = await addItemToBill(draft.session.id, {
    name,
    quantity,
    unitPrice,
    productId,
    priceSource,
  });
  return billReply(updated, `Added ${name} × ${quantity}.`);
}

async function handleRemoveItem(businessId: string, args: string): Promise<Reply> {
  const draft = await getCurrentDraft(businessId);
  if (!draft) return { text: "No open bill to change. Send me an order first." };

  const name = args.trim();
  if (name.length === 0) return { text: "Which item should I remove?" };

  const updated = await removeItemFromBill(draft.session.id, name);
  if (!updated) return { text: `"${name}" isn't on this bill.` };
  if (updated.items.length === 0) return { text: "That was the last item — the bill is now empty." };
  return billReply(updated, `Removed ${name}.`);
}

async function handleShowBill(businessId: string): Promise<Reply> {
  const draft = await getCurrentDraft(businessId);
  if (!draft) return { text: "No open bill. Send me an order and I'll make one." };
  return billReply(draft);
}

// Resolves which bill the seller means: the one they numbered ("#1042"),
// the one belonging to the customer they named ("open ravi bill"), or the
// one they're currently working on. Never guesses across businesses.
//
// The customer branch is a HARD address, not a hint. When Ravi has no
// bill this returns null and the caller says so; it must never slide back
// to getCurrentDraft, which is how "open ravi bill" answered with a
// different customer's #1009 — and, on the payment path, would have
// marked the wrong person's bill paid.
async function resolveBill(
  businessId: string,
  billNo: number | null,
  customer: string | null = null,
): Promise<StoredBill | null> {
  if (billNo !== null) return getBillByNo(businessId, billNo);
  if (customer) return getLatestBillForCustomer(businessId, customer);
  return getCurrentDraft(businessId);
}

// Names the customers the seller could have meant. The alternative — a
// flat "I don't have a bill for Ravi" when two Ravis exist — is worse than
// unhelpful: it reads as though their records are gone.
function askWhichCustomer(err: CustomerAmbiguousError): Reply {
  const names = err.candidates.map(titleCase);
  return {
    text:
      `You have ${names.length} customers matching that:\n` +
      names.map((n) => `  \u2022 ${n}`).join("\n") +
      `\n\nWhich one? Say the full name, like: ${names[0]}`,
  };
}

// "I don't have a bill for Ravi" beats "no open bill" when the seller
// named someone: it tells them WHICH assumption of theirs was wrong.
function noBillFor(customer: string | null, fallback: string): string {
  return customer
    ? `I don't have a bill for ${titleCase(customer)}. Say "open bills" to see what's unconfirmed.`
    : fallback;
}

// Attaches a customer to a bill. Only ever adds the identity that was
// missing — it never touches items, quantities or money, so naming a bill
// cannot change what it is worth.
async function handleSetCustomer(
  businessId: string,
  billNo: number | null,
  customer: string | null,
): Promise<Reply> {
  if (!customer) {
    return { text: "Who is this bill for? Say: this is Ravi" };
  }

  const bill = await resolveBill(businessId, billNo);
  if (!bill) {
    return { text: "No open bill to name. Send me an order and I'll make one." };
  }

  const updated = await setBillCustomer(businessId, bill.session.id, customer);
  if (!updated) return { text: "Couldn't use that as a customer name." };

  const who = titleCase(updated.session.customer_ref ?? customer);
  return {
    ...billReply(updated, `Bill #${updated.session.bill_no} is ${who}'s.`),
    actions: billActions(updated),
  };
}

async function handleConfirm(
  businessId: string,
  billNo: number | null,
  customer: string | null = null,
): Promise<Reply> {
  const bill = await resolveBill(businessId, billNo, customer);
  if (!bill) {
    return {
      text: noBillFor(customer, "No open bill to confirm. Send me an order and I'll make one."),
    };
  }
  if (bill.session.status === "finalized") {
    return { text: `Bill #${bill.session.bill_no} is already confirmed.`, actions: billActions(bill) };
  }

  await finalizeBill(bill.session.id);
  const sales = await getTodaysSales(businessId);
  const confirmed = {
    ...bill,
    session: { ...bill.session, status: "finalized" as const },
  };
  // The confirmation note sits AFTER the bill here, so it is appended
  // outside the monospace block rather than folded into it.
  const reply = billReply(confirmed);
  return {
    ...reply,
    text:
      `${reply.text}\n` +
      escapeHtml(
        `Confirmed. Today: ${sales.count} bill(s), ${formatRupees(sales.total)}` +
          (sales.openCount > 0
            ? `\n${sales.openCount} still unconfirmed — say "open bills".`
            : ""),
      ),
  };
}

// Payment is recorded only from the SELLER's explicit statement. A customer
// saying "paid" never reaches this — that is a claim, not a receipt.
async function handlePayment(
  businessId: string,
  billNo: number | null,
  amount: number | null,
  customer: string | null = null,
): Promise<Reply> {
  const bill = await resolveBill(businessId, billNo, customer);
  if (!bill) {
    return {
      text: noBillFor(
        customer,
        "Which bill was paid? Tell me the number, like: #1042 paid",
      ),
    };
  }

  const updated = await recordPayment(bill.session.id, amount);
  if (!updated) return { text: "Couldn't find that bill." };

  const note =
    updated.session.payment_status === "paid"
      ? `Marked #${updated.session.bill_no} paid in full.`
      : `Recorded ${formatRupees(Number(updated.session.amount_paid))} against #${updated.session.bill_no}. ` +
        `${formatRupees(Number(updated.session.total) - Number(updated.session.amount_paid))} still due.`;

  return billReply(updated, note);
}

async function handleDone(businessId: string): Promise<Reply> {
  return handleConfirm(businessId, null);
}

// Reports confirmed sales AND unconfirmed drafts. Showing only confirmed
// bills was technically true and practically misleading: a seller who had
// made a dozen bills saw a total covering two of them, with no indication
// the rest existed or how to find them.
async function handleSales(businessId: string, text: string): Promise<Reply> {
  // "sales", "yesterday sales", "sales 8 sep", "this month" — the period
  // comes from the seller's own words; no period means today.
  const range = parseDateRange(text);
  const label = range?.label ?? "Today";
  const s = await getSales(businessId, range ?? undefined);

  if (s.count === 0 && s.openCount === 0) {
    // "today"/"yesterday" read as adverbs; a named period needs "on".
    const when =
      label === "Today" || label === "Yesterday"
        ? label.toLowerCase()
        : `in ${label.toLowerCase()}`.replace("in last 7 days", "in the last 7 days");
    return { text: `Nothing billed ${when}.` };
  }

  const lines = [label];

  if (s.count > 0) {
    lines.push("", `${s.count} confirmed \u2014 ${formatRupees(s.total)}`);
    if (s.unpaidTotal > 0) {
      lines.push(`  ${formatRupees(s.paidTotal)} collected`);
      lines.push(`  ${formatRupees(s.unpaidTotal)} still owed`);
    } else {
      lines.push("  all paid");
    }
  } else {
    lines.push("", "Nothing confirmed yet.");
  }

  if (s.openCount > 0) {
    lines.push(
      "",
      `${s.openCount} unconfirmed \u2014 ${formatRupees(s.openTotal)}`,
      "These aren't counted yet. Say \"open bills\" to see them.",
    );
  }

  return { text: lines.join("\n") };
}

async function handleOpenBills(businessId: string): Promise<Reply> {
  const open = await getOpenBills(businessId);
  if (open.length === 0) {
    return { text: "No unconfirmed bills today \u2014 everything is closed off." };
  }
  const lines = open.map(
    (b) =>
      `#${b.bill_no}  ${b.customer_ref ? titleCase(b.customer_ref) : "no name"}  ` +
      `${formatRupees(Number(b.total))}  \u00b7  ${formatBusinessDateTime(new Date(b.created_at))}`,
  );
  return {
    text:
      `${open.length} unconfirmed bill(s):\n\n${lines.join("\n")}\n\n` +
      `Open one with "show #${open[0]!.bill_no}", then Confirm.`,
  };
}

// A correction ("actually paneer was 3") changes the bill that is already
// open. It is routed through the SAME deterministic edit path as an
// explicit "/plus" — the seller is stating a fact about their own order,
// so there is nothing to infer and nothing to approve.
async function handleCorrection(businessId: string, text: string): Promise<Reply> {
  const draft = await getCurrentDraft(businessId);
  if (!draft) {
    return { text: "There's no open bill to correct. Send me the order and I'll make one." };
  }

  // "actually paneer was 3" / "make it 3 paneer" / "change paneer to 3"
  const lower = text.toLowerCase();
  const patterns = [
    /(?:actually\s+)?([a-z ]+?)\s+(?:was|is|to|hai)\s+(\d+)/i,
    /(?:make it|change|update)\s+(\d+)\s+([a-z ]+)/i,
    /(\d+)\s+([a-z ]+?)\s*$/i,
  ];

  for (const pattern of patterns) {
    const m = lower.match(pattern);
    if (!m) continue;
    const [a, b] = [m[1]!.trim(), m[2]!.trim()];
    const quantity = Number(/^\d+$/.test(a) ? a : b);
    const name = /^\d+$/.test(a) ? b : a;
    if (!Number.isInteger(quantity) || quantity <= 0 || name.length === 0) continue;

    const onBill = draft.items.find(
      (i) => i.name_snapshot.toLowerCase() === name || name.includes(i.name_snapshot.toLowerCase()),
    );
    if (!onBill) continue;

    const updated = await setItemQuantity(draft.session.id, onBill.id, quantity);
    return {
      ...billReply(updated, `Updated ${titleCase(onBill.name_snapshot)} to × ${quantity}.`),
      actions: billActions(updated),
    };
  }

  return {
    text:
      "I didn't catch what changed. Tell me like:\n" +
      "  paneer was 3\n  add 2 lassi\n  remove chutney",
  };
}

async function resolveBusiness(incoming: IncomingMessage): Promise<string> {
  return getOrCreateBusinessForChannel(
    incoming.platform,
    incoming.platformUserId,
    incoming.displayName,
  );
}

export async function handleIncoming(incoming: IncomingMessage): Promise<Reply> {
  let businessId: string;
  try {
    businessId = await resolveBusiness(incoming);
  } catch (err) {
    return { text: `Couldn't reach the price store: ${(err as Error).message}` };
  }

  // A forwarded message IS the order. The seller forwarded it precisely so
  // they wouldn't have to retype it, so it is treated as the order text
  // with no command required.
  const orderText = incoming.forwardedText?.trim();
  const trimmed = (orderText && orderText.length > 0 ? orderText : incoming.text).trim();
  const sourceMessageId = incoming.messageId ?? null;

  const commands = splitCommands(trimmed);

  // RULE 1: A COMMAND ALWAYS RUNS.
  //
  // Setup used to sit above this and swallow everything, so during setup
  // "/prices" was saved as a product called "/prices", and "2 paneer 3
  // samosa" - an ORDER - became two price-list rows. A seller could not
  // reach /help to get out of it.
  //
  // Nothing may ever sit above command routing again. A slash command is
  // the one input whose meaning is not in question, so it is never
  // interpreted by whatever mode the seller happens to be in.
  const isCommand = commands.length > 1 || (commands[0] && commands[0].command !== "");

  if (!isCommand) {
    // ANSWERING THE LAST QUESTION.
    //
    // Checked before onboarding and before intent routing, because a reply
    // to a question Likho just asked is not a new request. It returns null
    // whenever the message does not identify an option, so nothing is ever
    // blocked behind a question — and an order-shaped message is refused
    // outright, so billing can never be swallowed by a stale prompt.
    // The catch guards the LOOKUP ONLY. Wrapping the action too meant a
    // failure inside it was swallowed and the message fell through to the
    // order parser, which looked exactly like the answer not being
    // understood — and hid the real error completely.
    let answered: ChoiceOption | null = null;
    try {
      answered = await resolvePendingChoice(businessId, trimmed);
    } catch {
      // A failed lookup must never stop a message being handled normally.
    }
    if (answered) return await handleAction(incoming, answered.action);

    try {
      const onboarding = await loadOnboarding(businessId);
      if (onboarding.step !== "done") {
        return await handleOnboarding(businessId, onboarding, incoming, trimmed, sourceMessageId);
      }
    } catch (err) {
      return { text: `Something went wrong: ${(err as Error).message}` };
    }
  }

  // Explicit commands still win — a seller who typed one meant it.
  if (isCommand) {
    const replies: Reply[] = [];
    for (const c of commands) {
      replies.push(await runCommand(businessId, incoming, c.command, c.args, trimmed, sourceMessageId));
    }
    if (replies.length === 1) return remember(businessId, replies[0]!);
    const last = replies[replies.length - 1]!;
    return remember(businessId, {
      text: replies.map((r) => r.text).join("\n\n———\n\n"),
      // Actions from the LAST reply — that's the state the seller ends on.
      actions: last.actions,
      choices: last.choices,
    });
  }

  // No command: the conversation layer decides.
  return remember(businessId, await runIntent(businessId, incoming, trimmed, sourceMessageId));
}

// Stores the options a reply offered, so the seller can answer in words.
// A reply that asks nothing CLEARS the stored question — otherwise an
// answer typed much later would attach to a prompt long since moved on
// from.
async function remember(businessId: string, reply: Reply): Promise<Reply> {
  try {
    if (reply.choices?.length) await setPendingChoice(businessId, reply.choices);
    else await clearPendingChoice(businessId);
  } catch {
    // Never let bookkeeping swallow a reply the seller is waiting on.
  }
  return reply;
}

// Natural-language dispatch. This is what makes commands optional.
async function runIntent(
  businessId: string,
  incoming: IncomingMessage,
  text: string,
  sourceMessageId: string | null,
): Promise<Reply> {
  const intent = classifyIntent(text);

  try {
    switch (intent.name) {
      case "help":
        return { text: HELP };
      case "setup":
        return await handleRestartSetup(businessId);
      case "greeting":
        return { text: GREETING_REPLY };
      case "prices":
        return await handlePrices(businessId);
      case "sales": {
        // "kitna hua ravi ka" asks about a PERSON, not the shop's day.
        // The words overlap ("kitna" means both), so the seller's own
        // customer list breaks the tie: if the message names someone, it
        // is a question about them.
        if (!/\d/.test(stripDateExpressions(text))) {
          const named = await findCustomerInMessage(businessId, stripDateExpressions(text));
          if (named && named !== "ambiguous") {
            return await handleCustomerHistory(businessId, named.name, parseDateRange(text));
          }
        }
        return await handleSales(businessId, text);
      }
      case "open_bills":
        return await handleOpenBills(businessId);
      case "show_bill": {
        const bill = await resolveBill(businessId, intent.billNo, intent.customer);
        if (!bill) {
          return {
            text: intent.billNo
              ? `I don't have a bill #${intent.billNo}.`
              : noBillFor(intent.customer, "No open bill. Send me an order and I'll make one."),
          };
        }
        return billReply(bill);
      }
      case "confirm":
        return await handleConfirm(businessId, intent.billNo, intent.customer);
      case "payment":
        return await handlePayment(businessId, intent.billNo, intent.amount, intent.customer);
      case "pdf":
        return await handleBillPdf(businessId, intent.billNo);
      case "customer_statement": {
        const named = await findCustomerInMessage(businessId, stripDateExpressions(text));
        if (named === "ambiguous") {
          return { text: "That names more than one customer. Which one did you mean?" };
        }
        if (!named) return await notAnOrderReply(businessId, stripDateExpressions(text));
        return await handleStatement(businessId, named.name, parseDateRange(text), incoming.onSlowWork);
      }
      case "customer_history": {
        // intent.text is only a hint. When it names nobody real — or is
        // absent because a question guard dropped it — scan the message
        // against the seller's own customer list.
        const direct = intent.text?.trim();
        if (direct) {
          const hit = await findCustomer(businessId, direct).catch(() => null);
          if (hit) return await handleCustomerHistory(businessId, hit.name, parseDateRange(text));
        }
        const scanned = await findCustomerInMessage(businessId, stripDateExpressions(text));
        if (scanned === "ambiguous") {
          return { text: "That names more than one customer. Which one did you mean?" };
        }
        if (scanned) return await handleCustomerHistory(businessId, scanned.name, parseDateRange(text));

        const recent = await recallCustomer(businessId);
        if (recent) return await handleCustomerHistory(businessId, recent.name, parseDateRange(text));
        return await notAnOrderReply(businessId, stripDateExpressions(text));
      }
      case "settle_customer":
        return await handleSettle(businessId, text);
      case "outstanding": {
        // A follow-up question with no name means the person we were just
        // discussing. Only the ANSWER uses this; nothing is written.
        //
        // But "who hasn't paid" asks across EVERYONE — the word "who" is
        // the question. Falling back to the last customer there answered a
        // shop-wide question about one person, which is a worse error than
        // not remembering at all.
        const asksEveryone = /\b(who|kaun|kisne|everyone|everybody|all|sab|sabhi)\b/i.test(text);
        const namedHere = await findCustomerInMessage(businessId, stripDateExpressions(text));
        if (!namedHere) {
          if (asksEveryone) return await handleOutstanding(businessId);
          const recent = await recallCustomer(businessId);
          if (recent) return await handleCustomerHistory(businessId, recent.name);
        } else if (namedHere !== "ambiguous") {
          return await handleCustomerHistory(businessId, namedHere.name);
        }
        return await handleOutstanding(businessId);
      }
      case "mock":
        return await handleMock(businessId);
      case "bill_format":
        return await handleBillFormat(businessId, incoming.onSlowWork);
      case "business_info":
        return await handleBusinessInfo(businessId, intent.text);
      case "pdf":
        return await handleBillPdf(businessId, intent.billNo, intent.customer);
      case "learned":
        return await handleLearned(businessId);
      case "forget":
        return await handleForget(businessId, intent.text);
      case "set_discount":
        return await handleSetDiscount(businessId, intent.amount ?? 0, text);
      case "keep_only":
        return await handleKeepOnly(businessId, intent.text);
      case "rename":
        return await handleRename(businessId, intent.text);
      case "add_item":
        // Same deterministic edit path "/plus" uses — no model involved,
        // because the seller is stating exactly what they want.
        return await handleAddItem(businessId, intent.text);
      case "remove_item":
        return await handleRemoveItem(businessId, intent.text);
      case "set_customer":
        return await handleSetCustomer(businessId, intent.billNo, intent.customer);
      case "correction":
        return await handleCorrection(businessId, text);
      case "order":
      default: {
        // RULE: a bare name is a QUESTION, never an instruction.
        //
        // "ravi" has no items in it, so reading it as an order could only
        // ever produce an empty bill. If it names someone the seller has
        // billed before, show that person instead. The digit test does the
        // separating: "ravi" looks them up, "ravi 2 chai" bills them.
        // Strips filler and bill-words, then asks the seller's OWN customer
        // list whether what remains names anyone. This is what makes
        // "dude get me bill of ria" work without a pattern for it.
        // The date is removed BEFORE the name is extracted, because a date
        // carries digits and a digit is what tells an order from a
        // question. Stripping it means "tanishk bills 10 sept" reads as a
        // name plus a date, while "ria 2 chai today" keeps its 2 and stays
        // an order.
        // The date is removed first: a date carries digits, and a digit is
        // what tells an order from a question about one. The digit rule
        // itself is never relaxed.
        const range = parseDateRange(text);
        const withoutDate = stripDateExpressions(text);

        // No quantity anywhere means this cannot be an order, so it is
        // safe to ask whether the message NAMES anyone. Scanning for a
        // known customer needs no list of English filler words — which is
        // what the two previous attempts got wrong.
        if (!/\d/.test(withoutDate)) {
          const named = await findCustomerInMessage(businessId, withoutDate);
          if (named === "ambiguous") {
            return { text: "That names more than one customer. Which one did you mean?" };
          }
          if (named) return await handleCustomerHistory(businessId, named.name, range);

          // NOBODY MATCHED, AND THERE IS NO QUANTITY HERE.
          //
          // A bill needs a quantity. Without one there is nothing to
          // charge for, so handing this to the order parser can only
          // produce a question with no answer — which is exactly what
          // happened: "what about ria" came back "What items did Ria
          // order?", then "Couldn't find any items in this order."
          //
          // The catalog decides whether it is worth asking: a message that
          // names a real product but no quantity IS an unfinished order and
          // deserves the question. One naming neither is not an order at
          // all and gets a straight answer instead of an interrogation.
          const unfinished = await mentionsKnownProduct(businessId, withoutDate);
          if (!unfinished) {
            return notAnOrderReply(businessId, withoutDate);
          }
        }
        return await handleOrder(businessId, text, sourceMessageId, incoming.onSlowWork);
      }
    }
  } catch (err) {
    // Caught here rather than in each handler: show_bill, payment, confirm
    // and pdf all address a bill by name, and all owe the seller the same
    // answer when that name fits two people.
    if (err instanceof CustomerAmbiguousError) return askWhichCustomer(err);
    return { text: `Something went wrong: ${(err as Error).message}` };
  }
}

// A button press runs the SAME handlers a typed message does, so the two
// can never drift apart. The action string is opaque to the channel.
export async function handleAction(incoming: IncomingMessage, action: string): Promise<Reply> {
  let businessId: string;
  try {
    businessId = await resolveBusiness(incoming);
  } catch (err) {
    return { text: `Couldn't reach the price store: ${(err as Error).message}` };
  }

  // A spelling fix carries two names rather than a bill number, so it is
  // decoded before the number-based actions.
  // Learning an alias: save it, then re-run the order that could not be
  // priced. The seller taught their own price list; the same question is
  // never asked again, because buildCatalogIndex treats an alias as an
  // exact key.
  // Setup taps. Decoded first: they carry a kind or a bare verb rather
  // than a bill number, so the number-based decoding below cannot see them.
  const kind = decodeKind(action);
  if (kind) {
    try {
      return await applyKind(businessId, kind);
    } catch (err) {
      return { text: `Something went wrong: ${(err as Error).message}` };
    }
  }

  if (action === SKIP_ACTION || action === FORMAT_ACTION || action === SHOP_ACTION) {
    try {
      if (action === SKIP_ACTION) return await handleSkipSetup(businessId);
      if (action === FORMAT_ACTION) return await handleBillFormat(businessId, incoming.onSlowWork);
      return await handleBusinessInfo(businessId, "");
    } catch (err) {
      return { text: `Something went wrong: ${(err as Error).message}` };
    }
  }

  if (action.startsWith("settle:")) {
    try {
      const customers = await listCustomers(businessId);
      const customer = customers.find((c) => c.id === action.slice(7));
      if (!customer) return { text: "That customer isn't in your list any more." };

      const done = await settleAllForCustomer(businessId, customer);
      if (done.billNos.length === 0) {
        return { text: `${titleCase(customer.name)} already had nothing outstanding.` };
      }
      return {
        text:
          `${titleCase(customer.name)} settled.\n\n` +
          `${done.billNos.length} bill${done.billNos.length === 1 ? "" : "s"} marked paid ` +
          `(${done.billNos.map((n) => `#${n}`).join(", ")})\n` +
          `${formatRupees(done.amount)} recorded as received.`,
      };
    } catch (err) {
      return { text: `Something went wrong: ${(err as Error).message}` };
    }
  }

  if (action.startsWith("stmt:")) {
    try {
      const customerId = action.slice(5);
      const customers = await listCustomers(businessId);
      const customer = customers.find((c) => c.id === customerId);
      if (!customer) return { text: "That customer isn't in your list any more." };
      return await handleStatement(businessId, customer.name, null, incoming.onSlowWork);
    } catch (err) {
      return { text: `Something went wrong: ${(err as Error).message}` };
    }
  }

  const [openVerb, openNo] = action.split(":");
  if (openVerb === "open" && openNo && /^\d+$/.test(openNo)) {
    try {
      const bill = await getBillByNo(businessId, Number(openNo));
      if (!bill) return { text: `I don't have a bill #${openNo}.` };
      return billReply(bill);
    } catch (err) {
      return { text: `Something went wrong: ${(err as Error).message}` };
    }
  }

  const templateId = decodeTemplate(action);
  if (templateId) {
    try {
      await setBillTemplate(businessId, asTemplateId(templateId));
      const label = TEMPLATE_LABELS[asTemplateId(templateId)];
      return {
        text: `Your bills now use the ${label.name} style.\n\nTap PDF on any bill to get it.`,
      };
    } catch (err) {
      return { text: `Something went wrong: ${(err as Error).message}` };
    }
  }

  const meantId = decodeMeant(action);
  if (meantId) {
    try {
      const pending = await takePendingResolution(businessId);
      const product = await getProductById(businessId, meantId);
      if (!product) return { text: "That item isn't in your price list any more." };
      if (!pending) {
        return { text: "That question has already been answered. Send the order again." };
      }

      await addAlias(product.id, pending.term);

      const rerun = await handleOrder(businessId, pending.message, null, incoming.onSlowWork);
      return {
        text: `Got it \u2014 "${pending.term}" means ${titleCase(product.name)}. I won't ask again.\n\n${rerun.text}`,
        actions: rerun.actions,
      };
    } catch (err) {
      return { text: `Something went wrong: ${(err as Error).message}` };
    }
  }

  const priceChange = decodePriceChange(action);
  if (priceChange) {
    try {
      await upsertProduct(businessId, priceChange.name, priceChange.price);
      return {
        text:
          `"${priceChange.name}" is now ${formatRupees(priceChange.price)}.\n` +
          `Bills already made keep the price they were made with.`,
      };
    } catch (err) {
      return { text: `Something went wrong: ${(err as Error).message}` };
    }
  }

  const drop = decodeMerge(action);
  if (drop) {
    try {
      const removed = await deactivateProduct(businessId, drop);
      return {
        text: removed
          ? `Dropped "${drop}". Past bills that used it keep the name and price they were made with.`
          : `"${drop}" isn't in your price list any more.`,
      };
    } catch (err) {
      return { text: `Something went wrong: ${(err as Error).message}` };
    }
  }

  const fix = decodeFix(action);
  if (fix) {
    try {
      return await handleRename(businessId, `${fix.from} to ${fix.to}`);
    } catch (err) {
      return { text: `Something went wrong: ${(err as Error).message}` };
    }
  }

  const [verb, rawNo] = action.split(":");
  const billNo = rawNo && /^\d+$/.test(rawNo) ? Number(rawNo) : null;

  try {
    switch (verb) {
      case "confirm":
        return await handleConfirm(businessId, billNo);
      case "paid":
        return await handlePayment(businessId, billNo, null);
      case "pdf":
        return await handleBillPdf(businessId, billNo);
      default:
        return { text: "That action isn't available." };
    }
  } catch (err) {
    return { text: `Something went wrong: ${(err as Error).message}` };
  }
}

async function runCommand(
  businessId: string,
  incoming: IncomingMessage,
  command: string,
  args: string,
  trimmed: string,
  sourceMessageId: string | null,
): Promise<Reply> {
  const { onSlowWork } = incoming;
  try {
    switch (command) {
      case "/start":
      case "/help":
        return { text: HELP };
      case "/setup":
        return await handleRestartSetup(businessId);
      case "/add":
        return await handleAdd(businessId, args);
      case "/prices":
      case "/list":
      case "/items":
      case "/menu":
      case "/rates":
        return await handlePrices(businessId);
      case "/remove":
        return { text: await handleRemove(businessId, args) };
      case "/rename":
        return await handleRename(businessId, args);
      case "/mock":
        return await handleMock(businessId);
      case "/format":
      case "/style":
        return await handleBillFormat(businessId, onSlowWork);
      case "/shop":
        return await handleBusinessInfo(businessId, args);
      case "/pdf":
        return await handleBillPdf(businessId, null);
      case "/learned":
        return await handleLearned(businessId);
      case "/forget":
        return await handleForget(businessId, args);
      case "/zbill": {
        const replied = incoming.repliedText?.trim();
        const orderText = args.trim().length > 0 ? args.trim() : replied ?? "";
        if (orderText.length === 0) {
          return {
            text:
              "Send the order with it, or reply to the customer's message:\n" +
              "  /zbill 2 paneer 3 samosa",
          };
        }
        const anchorId =
          replied && args.trim().length === 0 && incoming.repliedMessageId
            ? incoming.repliedMessageId
            : sourceMessageId;
        return await handleOrder(businessId, orderText, anchorId, onSlowWork);
      }
      case "/plus":
      case "/additem":
        return await handleAddItem(businessId, args);
      case "/minus":
      case "/removeitem":
        return await handleRemoveItem(businessId, args);
      case "/bill":
        return await handleShowBill(businessId);
      case "/done":
        return await handleDone(businessId);
      case "/paid":
        return await handlePayment(businessId, null, null);
      case "/sales":
        return await handleSales(businessId, args.length > 0 ? args : trimmed);
      case "/open":
        return await handleOpenBills(businessId);
      default: {
        // An unrecognised slash command is a typo, not an order — never
        // silently bill it. The same near-match used for product names
        // names the command they meant, because dumping the whole help
        // text at someone who mistyped one letter is not an answer.
        const near = suggestFromList(command.replace(/^\//, ""), KNOWN_COMMANDS.map((c) => c.slice(1)));
        if (near) {
          return { text: `I don't know ${command}. Did you mean /${near}?` };
        }
        return { text: `I don't know ${command}.\n\n${HELP}` };
      }
    }
  } catch (err) {
    return { text: `Something went wrong: ${(err as Error).message}` };
  }
}
