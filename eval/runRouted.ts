import { routeParseOrder, RoutingFailedError } from "../src/router.js";
import { evalCases } from "./dataset.js";
import { summarizeLatencies } from "./stats.js";
import { itemsMatch } from "./matching.js";
import { isInfraError } from "./errorClassification.js";

// Scenario B: same 20-case dataset, run through the router (local Ollama
// first, escalating to Fireworks cloud only on local validation failure).
// Compare directly against eval/run.ts (scenario A, local-only).

// INFRA_ERROR — the request never got a real judgment from either provider
// (both unreachable, malformed, etc.) — excluded from reliable/dangerous
// tallies. See eval/errorClassification.ts.
type Outcome = "PASS" | "CORRECTLY_CLARIFIED" | "SILENTLY_WRONG" | "UNNECESSARILY_CLARIFIED" | "INFRA_ERROR";

interface CaseResult {
  id: number;
  category: string;
  message: string;
  outcome: Outcome;
  detail: string;
  provider: "local" | "cloud";
  escalated: boolean;
  localLatencyMs: number | null;
  cloudLatencyMs: number | null;
  totalLatencyMs: number;
}

async function runCase(c: (typeof evalCases)[number]): Promise<CaseResult> {
  try {
    const { parsed, log } = await routeParseOrder(c.message);
    const totalLatencyMs = (log.localLatencyMs ?? 0) + (log.cloudLatencyMs ?? 0);
    const base = {
      id: c.id,
      category: c.category,
      message: c.message,
      provider: log.selectedProvider,
      escalated: log.escalated,
      localLatencyMs: log.localLatencyMs,
      cloudLatencyMs: log.cloudLatencyMs,
      totalLatencyMs,
    };

    if (!c.expectSuccess) {
      return {
        ...base,
        outcome: "SILENTLY_WRONG",
        detail: `expected a refusal/clarification but got a confident result: ${JSON.stringify(parsed)}`,
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
      ...base,
      outcome: problems.length === 0 ? "PASS" : "SILENTLY_WRONG",
      detail: problems.length === 0 ? JSON.stringify(parsed) : problems.join("; "),
    };
  } catch (err) {
    // The router throws only after both providers failed. RoutingFailedError
    // carries the full log (latencies, trust signals) even on this path.
    const errorMessage = (err as Error).message;
    const log = err instanceof RoutingFailedError ? err.log : null;
    const outcome: Outcome = isInfraError(errorMessage)
      ? "INFRA_ERROR"
      : c.expectSuccess
        ? "UNNECESSARILY_CLARIFIED"
        : "CORRECTLY_CLARIFIED";
    return {
      id: c.id,
      category: c.category,
      message: c.message,
      outcome,
      detail: errorMessage,
      provider: "cloud",
      escalated: true,
      localLatencyMs: log?.localLatencyMs ?? null,
      cloudLatencyMs: log?.cloudLatencyMs ?? null,
      totalLatencyMs: log?.totalLatencyMs ?? 0,
    };
  }
}

async function main() {
  const results: CaseResult[] = [];

  for (const c of evalCases) {
    process.stdout.write(`Running #${c.id} (${c.category})... `);
    const result = await runCase(c);
    results.push(result);
    console.log(`${result.outcome} (${result.provider}${result.escalated ? ", escalated" : ""})`);
  }

  console.log("\n" + "=".repeat(70));
  console.log("DETAIL");
  console.log("=".repeat(70));
  for (const r of results) {
    console.log(`\n#${r.id} [${r.category}] ${r.outcome} — provider=${r.provider} escalated=${r.escalated}`);
    console.log(`  message: ${r.message}`);
    console.log(`  detail:  ${r.detail}`);
    console.log(`  latency: local=${r.localLatencyMs ?? "-"}ms cloud=${r.cloudLatencyMs ?? "-"}ms total=${r.totalLatencyMs}ms`);
  }

  const counts: Record<Outcome, number> = {
    PASS: 0,
    CORRECTLY_CLARIFIED: 0,
    SILENTLY_WRONG: 0,
    UNNECESSARILY_CLARIFIED: 0,
    INFRA_ERROR: 0,
  };
  for (const r of results) counts[r.outcome]++;

  const localCalls = results.filter((r) => r.localLatencyMs !== null).length;
  const cloudCalls = results.filter((r) => r.cloudLatencyMs !== null).length;
  const escalations = results.filter((r) => r.escalated).length;

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

  console.log(`\nLocal calls:             ${localCalls}/${results.length}`);
  console.log(`Cloud calls:             ${cloudCalls}/${results.length}`);
  console.log(`Escalation rate:         ${Math.round((escalations / results.length) * 100)}%`);

  const totalLatency = summarizeLatencies(results.map((r) => r.totalLatencyMs));
  console.log(`\nTotal latency (ms) — avg: ${totalLatency.avg}  p50: ${totalLatency.p50}  p95: ${totalLatency.p95}`);
}

main();
