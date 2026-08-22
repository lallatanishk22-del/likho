import { parseOrderWithLocalAI } from "../src/localAiParser.js";
import { evalCases } from "./dataset.js";
import { summarizeLatencies } from "./stats.js";
import { itemsMatch } from "./matching.js";
import { isInfraError } from "./errorClassification.js";

// Evaluates the current Ollama parser (reason -> structured interpretation ->
// hard boundary validation) against the SAME 20-case dataset used for the
// original baseline. No new cases, no tuning — this only measures whether
// the new architecture reduces silent errors vs. the 14/20 baseline.

// PASS                    — expected to succeed, succeeded, matched exactly.
// SILENTLY_WRONG          — produced a confident structured order that was
//                            either wrong (expected success) or should never
//                            have been produced at all (expected clarification).
//                            This is the dangerous category for a billing product.
// CORRECTLY_CLARIFIED     — expected a clarification/refusal, got one.
// UNNECESSARILY_CLARIFIED — expected success, but the system refused/asked
//                            for clarification on a case that was actually clear.
// INFRA_ERROR             — the request never actually got evaluated: Ollama/
//                            Fireworks was unreachable, returned malformed
//                            output, etc. Not a parser judgment either way —
//                            excluded from the reliable/dangerous tallies.
type Outcome = "PASS" | "CORRECTLY_CLARIFIED" | "SILENTLY_WRONG" | "UNNECESSARILY_CLARIFIED" | "INFRA_ERROR";

interface CaseResult {
  id: number;
  category: string;
  message: string;
  outcome: Outcome;
  detail: string;
  latencyMs: number;
}

async function runCase(c: (typeof evalCases)[number]): Promise<CaseResult> {
  const start = Date.now();
  try {
    const parsed = await parseOrderWithLocalAI(c.message);
    const latencyMs = Date.now() - start;

    if (!c.expectSuccess) {
      return {
        id: c.id,
        category: c.category,
        message: c.message,
        outcome: "SILENTLY_WRONG",
        detail: `expected a refusal/clarification but got a confident result: ${JSON.stringify(parsed)}`,
        latencyMs,
      };
    }

    const problems: string[] = [];
    if (c.expected?.customer !== undefined && (parsed.customer ?? null) !== c.expected.customer) {
      problems.push(`customer: expected ${JSON.stringify(c.expected.customer)}, got ${JSON.stringify(parsed.customer)}`);
    }
    if (
      c.expected?.discountPercent !== undefined &&
      (parsed.discountPercent ?? null) !== c.expected.discountPercent
    ) {
      problems.push(
        `discountPercent: expected ${JSON.stringify(c.expected.discountPercent)}, got ${JSON.stringify(parsed.discountPercent)}`,
      );
    }
    if (c.expected?.items) {
      const mismatch = itemsMatch(parsed.items, c.expected.items);
      if (mismatch) problems.push(mismatch);
    }

    return {
      id: c.id,
      category: c.category,
      message: c.message,
      outcome: problems.length === 0 ? "PASS" : "SILENTLY_WRONG",
      detail: problems.length === 0 ? JSON.stringify(parsed) : problems.join("; "),
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const errorMessage = (err as Error).message;
    if (isInfraError(errorMessage)) {
      return {
        id: c.id,
        category: c.category,
        message: c.message,
        outcome: "INFRA_ERROR",
        detail: errorMessage,
        latencyMs,
      };
    }
    if (c.expectSuccess) {
      return {
        id: c.id,
        category: c.category,
        message: c.message,
        outcome: "UNNECESSARILY_CLARIFIED",
        detail: errorMessage,
        latencyMs,
      };
    }
    return {
      id: c.id,
      category: c.category,
      message: c.message,
      outcome: "CORRECTLY_CLARIFIED",
      detail: errorMessage,
      latencyMs,
    };
  }
}

async function main() {
  const results: CaseResult[] = [];

  for (const c of evalCases) {
    process.stdout.write(`Running #${c.id} (${c.category})... `);
    const result = await runCase(c);
    results.push(result);
    console.log(result.outcome);
  }

  console.log("\n" + "=".repeat(70));
  console.log("DETAIL");
  console.log("=".repeat(70));
  for (const r of results) {
    console.log(`\n#${r.id} [${r.category}] ${r.outcome}`);
    console.log(`  message: ${r.message}`);
    console.log(`  detail:  ${r.detail}`);
  }

  const counts: Record<Outcome, number> = {
    PASS: 0,
    CORRECTLY_CLARIFIED: 0,
    SILENTLY_WRONG: 0,
    UNNECESSARILY_CLARIFIED: 0,
    INFRA_ERROR: 0,
  };
  for (const r of results) counts[r.outcome]++;

  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(`Total cases:             ${results.length}`);
  console.log(`PASS:                    ${counts.PASS}`);
  console.log(`CORRECTLY_CLARIFIED:     ${counts.CORRECTLY_CLARIFIED}`);
  console.log(`SILENTLY_WRONG:          ${counts.SILENTLY_WRONG}`);
  console.log(`UNNECESSARILY_CLARIFIED: ${counts.UNNECESSARILY_CLARIFIED}`);
  console.log(`INFRA_ERROR (unscored):  ${counts.INFRA_ERROR}`);
  const scored = results.length - counts.INFRA_ERROR;
  const reliable = counts.PASS + counts.CORRECTLY_CLARIFIED;
  console.log(`\nReliable outcomes:       ${reliable}/${scored} scored (${scored ? Math.round((reliable / scored) * 100) : 0}%)`);
  console.log(`Dangerous (silent):      ${counts.SILENTLY_WRONG}/${scored} scored`);

  const latency = summarizeLatencies(results.map((r) => r.latencyMs));
  console.log(`\nLatency (ms) — avg: ${latency.avg}  p50: ${latency.p50}  p95: ${latency.p95}`);
}

main();
