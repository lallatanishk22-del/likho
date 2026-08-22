import type { OrderItem } from "./types.js";

// Expected line shape: "<quantity> <item name...> <unitPrice> [each]"
// e.g. "2 chicken biryani 450" or "2 chicken biryani 450 each"
function parseLine(line: string): OrderItem {
  const tokens = line.trim().split(/\s+/);

  if (tokens.length > 0 && tokens[tokens.length - 1]!.toLowerCase() === "each") {
    tokens.pop();
  }

  if (tokens.length < 3) {
    throw new Error(`Could not parse line: "${line}" (expected: quantity, name, price)`);
  }

  const quantity = Number(tokens[0]);
  const unitPrice = Number(tokens[tokens.length - 1]);
  const name = tokens.slice(1, -1).join(" ");

  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`Invalid quantity in line: "${line}"`);
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new Error(`Invalid price in line: "${line}"`);
  }
  if (name.length === 0) {
    throw new Error(`Missing item name in line: "${line}"`);
  }

  return { name, quantity, unitPrice };
}

export function parseOrder(text: string): OrderItem[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseLine);
}
