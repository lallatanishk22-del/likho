import { routeParseOrder } from "./router.js";
import { calculateBill } from "./calculator.js";
import { formatBill } from "./formatter.js";

// Same pipeline as index.ts, but parsing goes through the router: local
// Ollama first, escalating to the Fireworks cloud model only if local fails
// hard validation. Requires Ollama running locally (ollama serve) with a
// model pulled (defaults to qwen2.5:7b — override with OLLAMA_MODEL /
// OLLAMA_URL). Cloud escalation requires FIREWORKS_API_KEY to be set.
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function main() {
  const input = await readStdin();

  if (input.trim().length === 0) {
    console.error("No input received. Pipe an order in, e.g.:");
    console.error('  printf "Rahul 2 paneer tikka 280 each 3 naan 60 each" | npm run start:ai');
    process.exit(1);
  }

  try {
    const { parsed } = await routeParseOrder(input);
    const bill = calculateBill(parsed.items, parsed.discountPercent ?? 0);
    console.log(formatBill(bill, parsed.customer));
  } catch (err) {
    console.error("Failed to process order:", (err as Error).message);
    process.exit(1);
  }
}

main();
