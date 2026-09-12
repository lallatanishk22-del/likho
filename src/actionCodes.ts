// The wire format for buttons.
//
// Telegram caps callback_data at 64 BYTES, and every one of these encoders
// returns null rather than truncating when the payload does not fit: a
// truncated product name would rename, merge or delete the WRONG product.
// The caller falls back to a typed command instead.
//
// Pulled out of messageHandler.ts, which had grown to 2,367 lines doing
// routing, thirty handlers, formatting and this encoding all at once.

import { TEMPLATE_IDS } from "./billData.js";

export function encodeTemplate(id: string): string {
  return `tpl:${id}`;
}
export function decodeTemplate(action: string): string | null {
  if (!action.startsWith("tpl:")) return null;
  const id = action.slice(4);
  return TEMPLATE_IDS.includes(id as never) ? id : null;
}

// Telegram caps callback_data at 64 BYTES. A rename carries two arbitrary
// product names, so it can overflow — in which case no button is offered
// and the seller is given the typed command instead. Returning null rather
// than truncating matters: a truncated name would rename the wrong thing.
const FIX_SEPARATOR = "\u001f"; // unit separator; cannot occur in a product name

export function encodeFix(from: string, to: string): string | null {
  const action = `fix:${from}${FIX_SEPARATOR}${to}`;
  return Buffer.byteLength(action, "utf8") <= 64 ? action : null;
}

export function decodeFix(action: string): { from: string; to: string } | null {
  if (!action.startsWith("fix:")) return null;
  const [from, to] = action.slice(4).split(FIX_SEPARATOR);
  if (!from || !to) return null;
  return { from, to };
}

// "You meant this product." Carries the product's id, which is stable and
// short enough for a button; the word being aliased lives in the pending
// row, so a long product name can never push this over the byte cap.
export function encodeMeant(productId: string): string {
  return `meant:${productId}`;
}

export function decodeMeant(action: string): string | null {
  if (!action.startsWith("meant:")) return null;
  const id = action.slice(6);
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

// A confirmed price change. The price rides in the action rather than
// being looked up again, so what the seller taps is exactly what they were
// shown - a second /add in between cannot change it underneath them.
export function encodePriceChange(name: string, price: number): string | null {
  const action = `price:${name}${FIX_SEPARATOR}${price}`;
  return Buffer.byteLength(action, "utf8") <= 64 ? action : null;
}

export function decodePriceChange(action: string): { name: string; price: number } | null {
  if (!action.startsWith("price:")) return null;
  const [name, rawPrice] = action.slice(6).split(FIX_SEPARATOR);
  if (!name || rawPrice === undefined) return null;
  const price = Number(rawPrice);
  if (!Number.isFinite(price) || price < 0) return null;
  return { name, price };
}

// Merging drops the older duplicate and keeps what the seller just typed.
export function encodeMerge(drop: string): string | null {
  const action = `merge:${drop}`;
  return Buffer.byteLength(action, "utf8") <= 64 ? action : null;
}

export function decodeMerge(action: string): string | null {
  if (!action.startsWith("merge:")) return null;
  const name = action.slice(6);
  return name.length > 0 ? name : null;
}
