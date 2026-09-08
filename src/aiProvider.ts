import type { ParsedOrder } from "./structuredOrder.js";
import type { PriceCatalog } from "./catalog.js";

// The rest of Likho talks to this interface, never to Ollama or Fireworks
// directly — so the router can swap providers without anything downstream
// caring which one actually ran.
export type ProviderName = "local" | "cloud";

// Optional per-request context. Omitted entirely by the CLI and the eval
// harness, which keeps their behaviour identical to before the price store
// existed: prices must be stated in the message.
export interface ParseOptions {
  catalog?: PriceCatalog;
}

export interface AiProvider {
  name: ProviderName;
  parseOrder(message: string, options?: ParseOptions): Promise<ParsedOrder>;
}
