import { parseOrder } from "./parser.js";
import { calculateBill } from "./calculator.js";
import { formatBill } from "./formatter.js";

// Reads the whole order from stdin, e.g.:
//   npm start < sample-order.txt
// or piped directly:
//   printf "2 chicken biryani 450\n1 raita 80\n" | npm start
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
    console.error('  printf "2 chicken biryani 450\\n1 raita 80\\n3 coke 40\\n" | npm start');
    process.exit(1);
  }

  try {
    const items = parseOrder(input);
    const bill = calculateBill(items);
    console.log(formatBill(bill));
  } catch (err) {
    console.error("Failed to process order:", (err as Error).message);
    process.exit(1);
  }
}

main();
