import { parseOrderWithLocalAIDiagnosed } from "../../src/localAiParser.js";
import { validateStructuredShape } from "../../src/structuredOrder.js";
import { computeTrustSignals, assessTrust } from "../../src/trustLayer.js";
import { exp5Messages } from "./exp5Messages.js";

// Experiment #5: Trust-Layer Stress Test. Identical harness pattern to
// runBaseline.ts / runExp4.ts — no production code changes. This runner
// additionally recomputes shape validation + trust signals directly (using
// the model's raw output already captured by parseOrderWithLocalAIDiagnosed)
// so trust signals can be inspected for EVERY case, not just ones the
// production pipeline happened to reject.
async function main() {
  for (const { id, message } of exp5Messages) {
    const start = Date.now();
    const d = await parseOrderWithLocalAIDiagnosed(message);
    const latencyMs = Date.now() - start;

    console.log(`#${id} (${latencyMs}ms)`);
    console.log(`  message:          ${message}`);
    console.log(`  MODEL_RESULT:     ${d.modelResult}${d.modelClarification ? ` ("${d.modelClarification}")` : ""}`);
    if (d.raw) console.log(`  RAW:              ${JSON.stringify(d.raw)}`);

    if (d.modelResult === "valid" && d.raw) {
      try {
        const shape = validateStructuredShape(d.raw, message);
        const trust = assessTrust(shape, message);
        console.log(`  SHAPE_VALIDATION: passed`);
        console.log(`  TRUST_SIGNALS:    ${JSON.stringify(computeTrustSignals(shape, message))}`);
        console.log(`  TRUST_RESULT:     ${trust.trusted ? "trusted" : "rejected"}${trust.reasons.length ? ` — ${trust.reasons.join("; ")}` : ""}`);
      } catch (err) {
        console.log(`  SHAPE_VALIDATION: rejected — ${(err as Error).message}`);
        console.log(`  TRUST_SIGNALS:    not_applicable (shape validation failed first)`);
      }
    } else {
      console.log(`  SHAPE_VALIDATION: not_applicable (model did not return status:valid)`);
    }

    console.log(`  VALIDATOR_RESULT: ${d.validatorResult}${d.validatorRejectionReason ? ` ("${d.validatorRejectionReason}")` : ""}`);
    console.log(`  FINAL_RESULT:     ${d.finalResult}${d.parsed ? ` — ${JSON.stringify(d.parsed)}` : ""}`);
    console.log();
  }
}

main();
