import Anthropic from "@anthropic-ai/sdk";
import type { OrderItem } from "./types.js";

// Structured output of the AI extraction step. This is the boundary between
// "AI interprets messy language" and "software validates + calculates money" —
// per CLAUDE.md, nothing past this point is allowed to touch financial math.
export interface ParsedOrder {
  customer: string | null;
  items: OrderItem[];
  discountPercent: number | null;
}

const EXTRACT_ORDER_TOOL: Anthropic.Tool = {
  name: "extract_order",
  description:
    "Extract a structured order from a seller's natural-language WhatsApp message. " +
    "Only fill in a unit price if the seller explicitly stated one for that item in this " +
    "message — never invent, estimate, or recall a price. Set confident to false if any " +
    "item name, quantity, or the overall structure of the order is ambiguous.",
  input_schema: {
    type: "object",
    properties: {
      customer: {
        type: ["string", "null"],
        description: "Customer name if mentioned in the message, otherwise null.",
      },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Item name." },
            quantity: { type: "integer", minimum: 1 },
            unitPrice: {
              type: ["number", "null"],
              description: "Unit price only if explicitly stated for this item in the message, else null.",
            },
          },
          required: ["name", "quantity", "unitPrice"],
        },
      },
      discountPercent: {
        type: ["number", "null"],
        description: "Discount percentage if mentioned, e.g. 10 for '10% discount'. Otherwise null.",
      },
      confident: {
        type: "boolean",
        description: "False if any item, quantity, or price is ambiguous and needs human confirmation.",
      },
      clarification: {
        type: ["string", "null"],
        description: "If confident is false, a short question to ask the seller. Otherwise null.",
      },
    },
    required: ["customer", "items", "discountPercent", "confident", "clarification"],
  },
};

export async function parseOrderWithAI(text: string): Promise<ParsedOrder> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 2048,
    tools: [EXTRACT_ORDER_TOOL],
    tool_choice: { type: "tool", name: "extract_order" },
    messages: [{ role: "user", content: text }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("AI did not return a structured order.");
  }

  return validateParsedOrder(toolUse.input as Record<string, unknown>);
}

// Never trust the LLM's output shape or numbers directly — validate every
// field before it can reach the deterministic calculator. Shared by
// localAiParser.ts, which extracts the same shape from a local model.
export function validateParsedOrder(raw: Record<string, unknown>): ParsedOrder {
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw new Error("Couldn't find any items in this order. Please resend the items and quantities.");
  }

  if (raw.confident === false) {
    const clarification =
      typeof raw.clarification === "string" && raw.clarification.trim().length > 0
        ? raw.clarification
        : "I couldn't understand this order confidently. Please resend the items and quantities.";
    throw new Error(clarification);
  }

  const items: OrderItem[] = raw.items.map((rawItem, index) => {
    const item = rawItem as Record<string, unknown>;

    if (typeof item.name !== "string" || item.name.trim().length === 0) {
      throw new Error(`AI returned an item with no name at position ${index + 1}.`);
    }
    if (typeof item.quantity !== "number" || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error(`Invalid quantity for "${item.name}". Please confirm the quantity.`);
    }
    if (typeof item.unitPrice !== "number" || item.unitPrice <= 0) {
      throw new Error(`No price found for "${item.name}". Please state the price, e.g. "${item.name} ₹100 each".`);
    }

    return { name: item.name.trim(), quantity: item.quantity, unitPrice: item.unitPrice };
  });

  const discountPercent =
    typeof raw.discountPercent === "number" && raw.discountPercent > 0 ? raw.discountPercent : null;

  const customer =
    typeof raw.customer === "string" && raw.customer.trim().length > 0 ? raw.customer.trim() : null;

  return { customer, items, discountPercent };
}
