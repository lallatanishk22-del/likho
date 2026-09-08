import type { ParsedOrder } from "./structuredOrder.js";
import { validateStructuredShape } from "./structuredOrder.js";
import { interpretAndTrust } from "./trustLayer.js";
import { ORDER_EXTRACTION_SYSTEM_PROMPT } from "./orderExtractionPrompt.js";
import type { AiProvider, ParseOptions } from "./aiProvider.js";
import { applyCatalog } from "./catalog.js";

// Extracts a structured order from messy WhatsApp-style text via a local
// Ollama model, then runs it through shape validation + the trust layer
// before anything can become a bill. The model interprets language; it does
// not get to decide what's financially safe.
const OLLAMA_URL = process.env["OLLAMA_URL"] ?? "http://localhost:11434/api/chat";
const OLLAMA_MODEL = process.env["OLLAMA_MODEL"] ?? "qwen2.5:7b";

interface OllamaChatResponse {
  message: { content: string };
}

async function callOllama(text: string): Promise<Record<string, unknown>> {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: "system", content: ORDER_EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      stream: false,
      format: "json",
      // Reproducibility: a fixed seed and zero temperature make repeated
      // runs on the same input directly comparable — without this, the same
      // message can silently flip between valid/clarification/wrong across
      // runs, which would make any single benchmark result meaningless.
      options: { temperature: 0, seed: 42 },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Local model unavailable (${response.status}). Is Ollama running? Try: ollama serve`,
    );
  }

  const data = (await response.json()) as OllamaChatResponse;

  try {
    return JSON.parse(data.message.content);
  } catch {
    throw new Error("Local model returned invalid JSON. Please try rephrasing the order.");
  }
}

export async function parseOrderWithLocalAI(text: string, options?: ParseOptions): Promise<ParsedOrder> {
  const raw = await callOllama(text);
  const withPrices = applyCatalog(raw, options?.catalog);
  const shape = validateStructuredShape(withPrices, text);
  return interpretAndTrust(shape, text);
}

export const localProvider: AiProvider = {
  name: "local",
  parseOrder: parseOrderWithLocalAI,
};

// Diagnostic variant: exposes the model's own verdict and the validator's
// verdict as SEPARATE fields, instead of collapsing both into one
// throw/return. This is what lets us tell "the model refused" apart from
// "the model answered confidently but our shape validation/trust layer
// rejected it" — those look identical from parseOrderWithLocalAI's outside,
// but are very different failures to fix.
export type ModelResult = "valid" | "clarification" | "malformed";
export type ValidatorResult = "passed" | "rejected" | "not_applicable";

export interface DiagnosedResult {
  modelResult: ModelResult;
  modelClarification: string | null;
  validatorResult: ValidatorResult;
  validatorRejectionReason: string | null;
  finalResult: "valid" | "clarification";
  finalReason: string | null;
  parsed: ParsedOrder | null;
  raw: Record<string, unknown> | null;
}

export async function parseOrderWithLocalAIDiagnosed(
  text: string,
  options?: ParseOptions,
): Promise<DiagnosedResult> {
  let raw: Record<string, unknown>;
  try {
    raw = await callOllama(text);
  } catch (err) {
    // Never even got a model verdict — infra/JSON failure, not a model or
    // validator judgment call.
    return {
      modelResult: "malformed",
      modelClarification: null,
      validatorResult: "not_applicable",
      validatorRejectionReason: null,
      finalResult: "clarification",
      finalReason: (err as Error).message,
      parsed: null,
      raw: null,
    };
  }

  const modelResult: ModelResult =
    raw["status"] === "valid" ? "valid" : raw["status"] === "clarification" ? "clarification" : "malformed";
  const modelClarification = typeof raw["clarification"] === "string" ? raw["clarification"] : null;

  if (modelResult !== "valid") {
    // The model itself declined — validator never runs, nothing to blame it for.
    return {
      modelResult,
      modelClarification,
      validatorResult: "not_applicable",
      validatorRejectionReason: null,
      finalResult: "clarification",
      finalReason: modelClarification ?? "Model returned an unrecognized response.",
      parsed: null,
      raw,
    };
  }

  try {
    const withPrices = applyCatalog(raw, options?.catalog);
    const shape = validateStructuredShape(withPrices, text);
    const parsed = interpretAndTrust(shape, text);
    return {
      modelResult,
      modelClarification,
      validatorResult: "passed",
      validatorRejectionReason: null,
      finalResult: "valid",
      finalReason: null,
      parsed,
      raw,
    };
  } catch (err) {
    // The model said "valid" and gave a confident answer — the VALIDATOR is
    // what turned this into a clarification, not the model's own judgment.
    return {
      modelResult,
      modelClarification,
      validatorResult: "rejected",
      validatorRejectionReason: (err as Error).message,
      finalResult: "clarification",
      finalReason: (err as Error).message,
      parsed: null,
      raw,
    };
  }
}
