import type { ParsedOrder } from "./structuredOrder.js";

// The rest of Likho talks to this interface, never to Ollama or Fireworks
// directly — so the router can swap providers without anything downstream
// caring which one actually ran.
export type ProviderName = "local" | "cloud";

export interface AiProvider {
  name: ProviderName;
  parseOrder(message: string): Promise<ParsedOrder>;
}
