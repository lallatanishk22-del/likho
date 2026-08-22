import { parseOrderWithLocalAIDiagnosed } from "../../src/localAiParser.js";
import { exp4Messages } from "./exp4Messages.js";

// Experiment #4: Validator Generalization Stress Test. Identical harness
// pattern to runBaseline.ts (Experiment #1) — no prompt/model/validator/
// schema/calculator/router changes, just a new message set. Prints raw
// output for every case so it can be graded against a ground truth defined
// BEFORE this run, not fitted to whatever comes out.
async function main() {
  for (const { id, message } of exp4Messages) {
    const start = Date.now();
    const d = await parseOrderWithLocalAIDiagnosed(message);
    const latencyMs = Date.now() - start;

    console.log(`#${id} (${latencyMs}ms)`);
    console.log(`  message:          ${message}`);
    console.log(`  MODEL_RESULT:     ${d.modelResult}${d.modelClarification ? ` ("${d.modelClarification}")` : ""}`);
    console.log(`  VALIDATOR_RESULT: ${d.validatorResult}${d.validatorRejectionReason ? ` ("${d.validatorRejectionReason}")` : ""}`);
    console.log(`  FINAL_RESULT:     ${d.finalResult}${d.parsed ? ` — ${JSON.stringify(d.parsed)}` : ""}`);
    if (d.raw) console.log(`  RAW:              ${JSON.stringify(d.raw)}`);
    console.log();
  }
}

main();
