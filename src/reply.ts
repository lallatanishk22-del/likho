import type { ChoiceOption } from "./pendingChoice.js";

// The shape of a conversation, independent of any channel.
//
// These types are shared by the router, every handler, the formatter and
// the Telegram adapter. They lived in messageHandler.ts, which meant
// chatFormat.ts had to import from the router just to name a Reply — a
// cycle that TypeScript erases but that would have become real the moment
// either file needed a value from the other.

export type Platform = "telegram" | "whatsapp";

// A reply is text PLUS the actions a seller can take on it. The core names
// the actions; each channel adapter decides how to show them (Telegram
// inline buttons today, something else on WhatsApp later). Nothing here
// knows what a button is.
export interface ReplyAction {
  label: string;
  // Opaque to the channel: "confirm:1042". Routed back through
  // handleAction() so a button press and a typed message run identical code.
  action: string;
}

export interface ReplyPhoto {
  path: string;
  caption?: string;
}

export interface ReplyDocument {
  path: string;
  caption?: string;
}

export interface Reply {
  text: string;
  // The options this reply is asking the seller to pick between. Stored so
  // the answer can be TYPED as well as tapped — see pendingChoice.ts.
  choices?: ChoiceOption[];
  // "HTML" lets a reply use <pre>, which is the only way Telegram will
  // render a text table in a fixed-width font.
  parseMode?: "HTML";
  // Extra messages sent after this one. Used by /mock, which has to show
  // several styles as SEPARATE bubbles — one message cannot be half
  // proportional and half monospace.
  follow?: Reply[];
  actions?: ReplyAction[];
  // Images to send before the text — used by the template picker, so the
  // seller compares actual bills rather than six words.
  photos?: ReplyPhoto[];
  // A file to send, e.g. a rendered bill PDF.
  document?: ReplyDocument;
}

export interface IncomingMessage {
  platform: Platform;
  // Stable per-seller identity on that platform (Telegram chat id today).
  platformUserId: string;
  displayName: string;
  text: string;
  messageId?: string | null;
  // Text of a message being replied to — how an order written by someone
  // else is handed to Likho without retyping it.
  repliedText?: string | null;
  repliedMessageId?: string | null;
  // Text of a message the seller FORWARDED to Likho. Treated as the order
  // itself: forwarding exists precisely so nothing has to be retyped.
  forwardedText?: string | null;
  // Optional hook so a slow channel can show a "working on it" signal.
  onSlowWork?: () => Promise<void>;
}

// Renders a bill from STORED state, so the seller always sees exactly what
// is persisted rather than a freshly recomputed guess.
