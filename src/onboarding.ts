// Setting a business up, as a conversation rather than a form.
//
// Until now a new seller's first message reached a bot that knew nothing
// about them: no shop name (it silently used their Telegram display name),
// an empty price list, and the default bill style. Their first real order
// hit "I don't have a price for paneer" — the worst possible first
// impression for a product whose whole promise is "just type the order".
//
// Three questions, in the order they pay off:
//   kind    -> picks a sensible bill style, so nobody has to browse six
//   name    -> the line at the top of every bill they will ever send
//   prices  -> the ONLY one that actually unblocks billing
//
// Everything else Likho needs (phone, UPI, GSTIN, customers, aliases) is
// learned from real usage. Asking for it up front would be a CRM form,
// which is exactly what the product direction forbids.
//
// This file is pure and deterministic: no model, no database, no channel.
// It decides what to ASK and how to READ an answer; messageHandler.ts does
// the saving. Setup writes prices, which decide what every future bill
// charges — there is nothing here worth letting a model guess at.

import { parsePriceList } from "./priceList.js";
import type { TemplateId } from "./billData.js";

export const ONBOARDING_STEPS = ["kind", "name", "prices", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function asOnboardingStep(value: unknown): OnboardingStep {
  // An unknown value means a row written by an older/newer version. Treat
  // it as finished: re-asking a working seller their shop name is worse
  // than skipping setup for a brand-new one.
  return ONBOARDING_STEPS.includes(value as OnboardingStep)
    ? (value as OnboardingStep)
    : "done";
}

// The shape messageHandler's Reply satisfies structurally. Declared here
// rather than imported so this module stays free of any dependency on the
// handler that consumes it.
export interface Question {
  text: string;
  actions?: { label: string; action: string }[];
}

// --- What kind of business ------------------------------------------------
//
// One question, and it buys two things: a bill style the seller never has
// to shop for, and price-list examples written in their own vocabulary. A
// tiffin seller shown "sugar 1kg 48" has to translate before answering.

export interface BusinessKind {
  id: string;
  label: string;
  // Starting bill style. Always changeable in one tap afterwards, which is
  // why guessing here is safe in a way that guessing a price never is.
  template: TemplateId;
  // Examples in this trade's own words, used to phrase the price question.
  examples: string[];
  // Sample order used to show them the very first thing to type.
  sampleOrder: string;
  // Typed answers that mean this kind, for a seller who writes instead of
  // tapping. Matched as whole words against the message.
  words: string[];
}

export const BUSINESS_KINDS: BusinessKind[] = [
  {
    id: "tiffin",
    label: "\u{1f371} Tiffin / home food",
    template: "food",
    examples: ["roti 8", "dal 60", "sabzi 70", "full dabba 120"],
    sampleOrder: "Ravi 2 dabba 4 roti",
    words: ["tiffin", "dabba", "home food", "homefood", "mess", "khana", "catering"],
  },
  {
    id: "restaurant",
    label: "\u{1f37d}️ Restaurant / cafe",
    template: "food",
    examples: ["paneer tikka 280", "naan 40", "coke 40"],
    sampleOrder: "Rahul 2 paneer tikka 3 naan",
    words: ["restaurant", "cafe", "hotel", "bakery", "cloud kitchen", "dhaba", "food"],
  },
  {
    id: "retail",
    label: "\u{1f6d2} Shop / retail",
    template: "retail",
    examples: ["sugar 1kg 48", "milk 500ml 32", "atta 5kg 260"],
    sampleOrder: "Meena 2 sugar 1 atta",
    words: ["shop", "retail", "grocery", "kirana", "store", "general store", "medical"],
  },
  {
    id: "other",
    label: "\u{1f4e6} Something else",
    template: "classic",
    examples: ["delivery 100", "service 500"],
    sampleOrder: "Ravi 1 delivery",
    words: ["other", "something else", "else", "none", "different"],
  },
];

const DEFAULT_KIND = BUSINESS_KINDS[BUSINESS_KINDS.length - 1]!;

export function kindById(id: string | null | undefined): BusinessKind {
  return BUSINESS_KINDS.find((k) => k.id === id) ?? DEFAULT_KIND;
}

export function encodeKind(id: string): string {
  return `kind:${id}`;
}

export function decodeKind(action: string): BusinessKind | null {
  if (!action.startsWith("kind:")) return null;
  return BUSINESS_KINDS.find((k) => k.id === action.slice(5)) ?? null;
}

// Reads a typed answer to the kind question. Accepts the position in the
// list ("2"), because a list shown with numbers WILL be answered with one.
export function readBusinessKind(raw: string): BusinessKind | null {
  const text = raw.trim().toLowerCase();
  if (text.length === 0) return null;

  const position = text.match(/^([1-9])[.)]?$/);
  if (position) {
    return BUSINESS_KINDS[Number(position[1]) - 1] ?? null;
  }

  for (const kind of BUSINESS_KINDS) {
    for (const word of kind.words) {
      if (new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, "i").test(text)) return kind;
    }
  }
  return null;
}

// --- Skipping -------------------------------------------------------------
//
// Every question must be refusable. A seller who wants to bill right now
// is the seller we are trying to win; making them answer three questions
// first is how a billing app loses to a paper notebook.

export const SKIP_ACTION = "onb:skip";

const SKIP_WORDS = [
  "skip", "later", "not now", "no", "nahi", "baad me", "baad mein",
  "afterwards", "cancel", "leave it", "chhod", "chod",
];

export function isSkip(raw: string): boolean {
  const text = raw.trim().toLowerCase().replace(/[^a-z ]/g, "").trim();
  return SKIP_WORDS.includes(text);
}

// --- Reading a shop name --------------------------------------------------

export type NameProblem = "empty" | "looks_like_an_order" | "too_long";
export type NameRead = { name: string } | { problem: NameProblem };

const MAX_NAME_LENGTH = 60;

// An escape hatch for the guard below: a shop genuinely called "Shri 1008
// Sweets" must be able to say so.
const EXPLICIT_NAME = /^shop\s+name\s+(.+)$/i;

export function readShopName(raw: string): NameRead {
  const explicit = raw.trim().match(EXPLICIT_NAME);
  const text = (explicit ? explicit[1]! : raw).trim().replace(/\s+/g, " ");

  if (text.length === 0) return { problem: "empty" };
  if (text.length > MAX_NAME_LENGTH) return { problem: "too_long" };
  if (explicit) return { name: text };

  // The real hazard at this step: the seller skips ahead and types an
  // order or a price list, and it becomes the name printed on every bill
  // they ever send. A standalone number among three or more words is what
  // separates "Ravi 2 paneer" from "Hotel 24" and "Cafe 24x7".
  const tokens = text.split(" ");
  const hasBareNumber = tokens.some((t) => /^(?:₹|rs\.?)?\d+(?:\.\d{1,2})?$/i.test(t));
  if (hasBareNumber && tokens.length > 2) return { problem: "looks_like_an_order" };
  if (parsePriceList(text).entries.length >= 2) return { problem: "looks_like_an_order" };

  return { name: text };
}

// A message that is clearly an order, sent while setup is still asking
// questions. Answering it beats finishing the questionnaire — the whole
// point of the product is that the seller types an order and gets a bill.
export function looksLikeAnOrder(raw: string): boolean {
  const text = raw.trim();
  if (!/\d/.test(text)) return false;
  return text.split(/\s+/).filter((t) => t.length > 0).length >= 2;
}

// --- The questions --------------------------------------------------------

function skipAction(label: string): { label: string; action: string } {
  return { label, action: SKIP_ACTION };
}

export function welcomeQuestion(retry: boolean): Question {
  const list = BUSINESS_KINDS.map((k, i) => `  ${i + 1}. ${k.label}`).join("\n");
  const opening = retry
    ? "Tap one of these, or type the number:"
    : "\u{1f44b} I'm Likho. You type the order, I make the bill.\n\n" +
      "Three quick questions and you're set.\n\nFirst — what do you sell?";

  return {
    text: `${opening}\n\n${list}\n\nOr say *skip* and start billing right away.`,
    actions: [
      ...BUSINESS_KINDS.map((k) => ({ label: k.label, action: encodeKind(k.id) })),
      skipAction("Skip setup"),
    ],
  };
}

export function nameQuestion(kind: BusinessKind, problem?: NameProblem): Question {
  const ask =
    "What's your business called?\n\nThis prints at the top of every bill your customers see.";

  const preface =
    problem === "looks_like_an_order"
      ? "That looks like an order, not a name — and it would end up on every bill.\n\n"
      : problem === "too_long"
        ? `That's longer than ${MAX_NAME_LENGTH} characters. Something shorter?\n\n`
        : problem === "empty"
          ? ""
          : `Good — ${kind.label.replace(/^\S+\s/, "")}. Your bills will use a style made for that.\n\n`;

  const escape =
    problem === "looks_like_an_order"
      ? '\n\nIf that really is the name, send:  shop name <your name>'
      : "";

  return {
    text: `${preface}${ask}${escape}`,
    actions: [skipAction("Skip — decide later")],
  };
}

export function pricesQuestion(kind: BusinessKind, shopName: string | null): Question {
  const preface = shopName ? `Saved — ${shopName}.\n\n` : "";
  return {
    text:
      `${preface}Last one, and it's the one that matters.\n\n` +
      `What do you sell, and for how much? Type them however you like — ` +
      `one per line, or all on one:\n\n` +
      kind.examples.map((e) => `  ${e}`).join("\n") +
      `\n\nI'll remember these and price every future order from them. ` +
      `You can add or change items any time.`,
    actions: [skipAction("Skip — I'll add them later")],
  };
}

// A seller who opens the bot and types an order straight away has told us
// exactly what they want. It still cannot be billed — there are no prices
// to bill it against — so the answer is to jump to the one question that
// unblocks them, not to hand them a questionnaire OR a dead end.
export function orderBeforePricesQuestion(kind: BusinessKind): Question {
  const q = pricesQuestion(kind, null);
  return {
    text:
      "That's exactly how to talk to me \u2014 but I don't know your prices " +
      "yet, so I'd be guessing at the money, and I won't do that.\n\n" +
      q.text.replace(/^Last one, and it's the one that matters\.\n\n/, ""),
    actions: q.actions,
  };
}

// Shown when the price answer produced nothing savable. Deliberately not a
// scolding: the seller has already been told which fragment failed by the
// price-list parser, so this only shows the shape that works.
export function pricesRetry(kind: BusinessKind): string {
  return (
    `Send each item with its price, like:\n\n` +
    kind.examples
      .slice(0, 2)
      .map((e) => `  ${e}`)
      .join("\n") +
    `\n\nOr say *skip* and add them later.`
  );
}

export const FORMAT_ACTION = "onb:format";
export const SHOP_ACTION = "onb:shop";

export function finishedMessage(
  kind: BusinessKind,
  shopName: string,
  itemNames: string[],
): Question {
  const summary =
    itemNames.length > 0
      ? `${shopName} · ${itemNames.length} item${itemNames.length === 1 ? "" : "s"} priced`
      : shopName;

  // The first order a seller types is the one that decides whether they
  // come back, so it is built from THEIR OWN saved items. The generic
  // example is a fallback only: suggesting "2 dabba" to someone whose list
  // says "full dabba" is handing them a failure on their first attempt.
  const sample =
    itemNames.length >= 2
      ? `Ravi 2 ${itemNames[0]} 1 ${itemNames[1]}`
      : itemNames.length === 1
        ? `Ravi 2 ${itemNames[0]}`
        : kind.sampleOrder;

  return {
    text:
      `✅ You're set up.\n\n${summary}\n\n` +
      `Now just talk to me. Send an order the way you'd say it:\n\n` +
      `  ${sample}\n\n` +
      `You can also forward a customer's message straight to me.`,
    actions: [
      { label: "\u{1f9fe} See bill styles", action: FORMAT_ACTION },
      { label: "\u{1f3ea} Add phone & UPI", action: SHOP_ACTION },
    ],
  };
}

// Leaving setup early. Says what is missing and how to come back, because
// a seller who skips prices WILL hit "I don't have a price for that" and
// needs to already know why.
export function skippedMessage(step: OnboardingStep): string {
  const missing =
    step === "prices"
      ? "I don't have your prices yet, so I can only bill orders that state " +
        "the price:\n  Ravi 2 paneer 220\n\nSend your rates whenever you like:\n  paneer 220\n  lassi 80"
      : "You can set your shop name and prices whenever you like:\n" +
        "  paneer 220\n  shop name Sharma Tiffin";

  return `No problem — setup's done.\n\n${missing}\n\nSay *setup* to go through it again.`;
}
