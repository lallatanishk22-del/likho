import fs from "node:fs";
import path from "node:path";
import { localProvider } from "./localAiParser.js";
import { cloudProvider } from "./cloudAiParser.js";
import type { ParsedOrder } from "./structuredOrder.js";
import type { ParseOptions, ProviderName } from "./aiProvider.js";
import { TrustRejectedError, type TrustSignals } from "./trustLayer.js";
import { CatalogResolutionError } from "./catalog.js";

export interface RoutingLog {
  timestamp: string;
  message: string;
  selectedProvider: ProviderName;
  escalated: boolean;
  escalationReason: string | null;
  localLatencyMs: number | null;
  cloudLatencyMs: number | null;
  totalLatencyMs: number;
  // Populated only when the corresponding attempt was rejected by the trust
  // layer specifically (as opposed to failing shape validation, which has
  // no relational signals to report).
  localTrustSignals: TrustSignals | null;
  cloudTrustSignals: TrustSignals | null;
  // Best-effort record of what each model actually proposed, even when
  // rejected — this is what makes rejections debuggable later.
  localInterpretation: unknown;
  cloudInterpretation: unknown;
  outcome: "valid" | "clarification";
  finalError: string | null;
}

const LOG_PATH = path.join(process.cwd(), "logs", "routing.log.jsonl");

function recordLog(log: RoutingLog): void {
  console.log(
    `[router] provider=${log.selectedProvider} escalated=${log.escalated}` +
      (log.escalationReason ? ` reason="${log.escalationReason}"` : "") +
      ` local_ms=${log.localLatencyMs ?? "-"} cloud_ms=${log.cloudLatencyMs ?? "-"} outcome=${log.outcome}`,
  );
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify(log) + "\n");
}

export interface RouteResult {
  parsed: ParsedOrder;
  log: RoutingLog;
}

// Attached to the error thrown when both providers fail, so callers (e.g.
// the eval harness) can still inspect latencies/signals on a clarification.
export class RoutingFailedError extends Error {
  log: RoutingLog;
  constructor(message: string, log: RoutingLog) {
    super(message);
    this.name = "RoutingFailedError";
    this.log = log;
  }
}

// Routing policy: try the local model first. Escalate to the cloud model —
// with the ORIGINAL message, never local's own output — if local fails
// EITHER shape validation (malformed/ungrounded claim) OR the trust layer
// (well-formed but relationally unsafe, e.g. a reused price with
// unexplained numbers left over). The question is never "is this message
// hard"; it's "did local prove it could safely interpret this one." The
// cloud result goes through the identical two-stage check — no double
// standard, no repairing local's output.
export async function routeParseOrder(
  message: string,
  options?: ParseOptions,
): Promise<RouteResult> {
  const log: RoutingLog = {
    timestamp: new Date().toISOString(),
    message,
    selectedProvider: "local",
    escalated: false,
    escalationReason: null,
    localLatencyMs: null,
    cloudLatencyMs: null,
    totalLatencyMs: 0,
    localTrustSignals: null,
    cloudTrustSignals: null,
    localInterpretation: null,
    cloudInterpretation: null,
    outcome: "clarification",
    finalError: null,
  };

  const localStart = Date.now();
  try {
    const parsed = await localProvider.parseOrder(message, options);
    log.localLatencyMs = Date.now() - localStart;
    log.totalLatencyMs = log.localLatencyMs;
    log.outcome = "valid";
    log.localInterpretation = parsed;
    recordLog(log);
    return { parsed, log };
  } catch (localErr) {
    log.localLatencyMs = Date.now() - localStart;
    // A catalog miss is deterministic — the cloud model reads the same
    // price store and would fail identically. Short-circuit so the seller
    // gets the actual "I don't have a price for X" message instead of a
    // cloud error, and we don't pay for a call that cannot help.
    if (localErr instanceof CatalogResolutionError) {
      log.totalLatencyMs = log.localLatencyMs;
      log.outcome = "clarification";
      log.finalError = localErr.message;
      recordLog(log);
      throw localErr;
    }
    log.escalated = true;
    log.escalationReason = (localErr as Error).message;
    if (localErr instanceof TrustRejectedError) {
      log.localTrustSignals = localErr.signals;
      log.localInterpretation = localErr.interpretation;
    }
  }

  log.selectedProvider = "cloud";
  const cloudStart = Date.now();
  try {
    const parsed = await cloudProvider.parseOrder(message, options);
    log.cloudLatencyMs = Date.now() - cloudStart;
    log.totalLatencyMs = log.localLatencyMs + log.cloudLatencyMs;
    log.outcome = "valid";
    log.cloudInterpretation = parsed;
    recordLog(log);
    return { parsed, log };
  } catch (cloudErr) {
    log.cloudLatencyMs = Date.now() - cloudStart;
    log.totalLatencyMs = log.localLatencyMs + log.cloudLatencyMs;
    log.outcome = "clarification";
    log.finalError = (cloudErr as Error).message;
    if (cloudErr instanceof TrustRejectedError) {
      log.cloudTrustSignals = cloudErr.signals;
      log.cloudInterpretation = cloudErr.interpretation;
    }
    recordLog(log);
    throw new RoutingFailedError((cloudErr as Error).message, log);
  }
}
