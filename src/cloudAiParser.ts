import type { ParsedOrder } from "./structuredOrder.js";
import { validateStructuredShape } from "./structuredOrder.js";
import { interpretAndTrust } from "./trustLayer.js";
import { ORDER_EXTRACTION_SYSTEM_PROMPT } from "./orderExtractionPrompt.js";
import type { AiProvider, ParseOptions } from "./aiProvider.js";
import { applyCatalog } from "./catalog.js";

// Stronger fallback brain, used only when the local model fails shape
// validation or the trust layer. It receives the ORIGINAL message and
// independently interprets it — it is a second opinion, not a repair
// function for local's output. The SAME shape validation + trust layer
// (structuredOrder.ts / trustLayer.ts) judges its result; the bar for
// "safe to bill" never changes based on which model answered.
const FIREWORKS_URL =
  process.env["FIREWORKS_URL"] ?? "https://api.fireworks.ai/inference/v1/chat/completions";
// llama-v3p1-70b-instruct was the default here for months and had been
// RETIRED by Fireworks the whole time — every escalation 404'd. Pin a
// model that is actually reachable, and keep the override so a dead
// default is a one-line env change rather than a deploy.
const FIREWORKS_MODEL =
  process.env["FIREWORKS_MODEL"] ?? "accounts/fireworks/models/gpt-oss-120b";

interface FireworksChatResponse {
  choices: { message: { content: string } }[];
}

export async function parseOrderWithCloudAI(text: string, options?: ParseOptions): Promise<ParsedOrder> {
  const apiKey = process.env["FIREWORKS_API_KEY"];
  if (!apiKey) {
    throw new Error("FIREWORKS_API_KEY is not set — cannot reach the cloud fallback model.");
  }

  const response = await fetch(FIREWORKS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: FIREWORKS_MODEL,
      messages: [
        { role: "system", content: ORDER_EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      response_format: { type: "json_object" },
      // Reproducibility, same reasoning as the local provider.
      temperature: 0,
      seed: 42,
    }),
  });

  // A DEAD MODEL AND A BAD KEY MUST NOT LOOK THE SAME.
  //
  // Both used to read "Cloud model unavailable (404)". They are opposite
  // problems — one is a config line, the other is an account — and hours
  // went into telling them apart from a log that refused to say which.
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Cloud model unavailable — FIREWORKS_API_KEY was rejected.");
    }
    if (response.status === 404) {
      throw new Error(`Cloud model unavailable — no such model "${FIREWORKS_MODEL}" on this account.`);
    }
    if (response.status === 429) {
      throw new Error("Cloud model unavailable — rate limited.");
    }
    throw new Error(`Cloud model unavailable (${response.status}).`);
  }

  const data = (await response.json()) as FireworksChatResponse;
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Cloud model returned no content.");
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error("Cloud model returned invalid JSON.");
  }

  const withPrices = applyCatalog(raw, options?.catalog);
  const shape = validateStructuredShape(withPrices, text);
  return interpretAndTrust(shape, text);
}

export const cloudProvider: AiProvider = {
  name: "cloud",
  parseOrder: parseOrderWithCloudAI,
};
