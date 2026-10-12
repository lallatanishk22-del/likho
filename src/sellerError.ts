// What a seller sees when something breaks: never a stack trace, a status
// code or a database constraint name. A raw "duplicate key value violates
// unique constraint" reached a seller's chat once; it told them nothing
// they could act on and made the product look broken.
//
// Messages written FOR the seller ("No price found for pizza", "What
// quantity of pizza?") pass through untouched — they are the product
// asking a question. Everything technical is replaced, and logged in full
// so it can still be debugged.

export const CONNECTION_MESSAGE = "I couldn't reach your records just now. Please try again in a minute.";
export const ORDER_MESSAGE = "I couldn't understand this order. Please send the items and quantities again.";
export const GENERIC_MESSAGE = "Sorry — something went wrong on my side. Please try again in a minute.";

const CONNECTION = /fetch failed|econn|etimedout|enotfound|eai_again|socket hang up|network|timed? ?out|(?:failed|error|status)\s*\(?(?:5\d\d|429)\)?/i;
const MODEL = /\bmodel\b|\bAI returned\b|json|unexpected token|structured order|fireworks|ollama|rate limited/i;
const TECHNICAL =
  /supabase|postgrest|pgrst|duplicate key|violates|constraint|(?:failed|error|status)\s*\(?\d{3}\)?|cannot read|undefined|\bnull\b|is not a function|typeerror|referenceerror|syntaxerror|rangeerror|api[_ ]?key|service_role|env var|\bat \S+ \(/i;

export type ErrorKind = "connection" | "order" | "generic" | "seller";

// The seller's own words — product and customer names — always arrive in
// double quotes. They are taken out before looking for technical words, so
// selling a "network cable" or a "model car" is not mistaken for a network
// or model failure. Technical messages still trip on what stays outside
// the quotes ("Supabase request failed", "fetch failed").
export function classifyError(message: string): ErrorKind {
  if (message.trim().length === 0) return "generic";
  const outsideQuotes = message.replace(/"[^"]*"|“[^”]*”/g, '""');
  if (CONNECTION.test(outsideQuotes)) return "connection";
  if (MODEL.test(outsideQuotes)) return "order";
  if (TECHNICAL.test(outsideQuotes)) return "generic";
  return "seller";
}

export function sellerFacing(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const kind = classifyError(message);
  if (kind === "seller") return message;
  console.error(`[likho] error hidden from seller (${kind}):`, err);
  if (kind === "connection") return CONNECTION_MESSAGE;
  if (kind === "order") return ORDER_MESSAGE;
  return GENERIC_MESSAGE;
}
