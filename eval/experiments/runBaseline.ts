import { parseOrderWithLocalAIDiagnosed } from "../../src/localAiParser.js";
import { baselineMessages } from "./baselineMessages.js";

// Experiment #1: Baseline. Current prompt, current local model, no changes.
// Logs MODEL_RESULT / VALIDATOR_RESULT / FINAL_RESULT separately so a model
// refusal can never be confused with a validator override of a confident
// model answer — critical before designing prompt experiments #2+.
async function main() {
  let modelValid = 0;
  let modelClarified = 0;
  let modelMalformed = 0;
  let validatorRejectedAModelValid = 0;

  for (const { id, message } of baselineMessages) {
    const start = Date.now();
    const d = await parseOrderWithLocalAIDiagnosed(message);
    const latencyMs = Date.now() - start;

    if (d.modelResult === "valid") modelValid++;
    else if (d.modelResult === "clarification") modelClarified++;
    else modelMalformed++;
    if (d.modelResult === "valid" && d.validatorResult === "rejected") validatorRejectedAModelValid++;

    console.log(`#${id} (${latencyMs}ms)`);
    console.log(`  message:          ${message}`);
    console.log(`  MODEL_RESULT:     ${d.modelResult}${d.modelClarification ? ` ("${d.modelClarification}")` : ""}`);
    console.log(`  VALIDATOR_RESULT: ${d.validatorResult}${d.validatorRejectionReason ? ` ("${d.validatorRejectionReason}")` : ""}`);
    console.log(`  FINAL_RESULT:     ${d.finalResult}${d.parsed ? ` — ${JSON.stringify(d.parsed)}` : ""}`);
    console.log();
  }

  console.log("=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(`Total messages:                          ${baselineMessages.length}`);
  console.log(`MODEL said valid:                         ${modelValid}`);
  console.log(`MODEL said clarification (model's call):  ${modelClarified}`);
  console.log(`MODEL malformed/unparseable:               ${modelMalformed}`);
  console.log(`VALIDATOR rejected a model-confident answer: ${validatorRejectedAModelValid}`);
  console.log(
    `\nOf the model's ${modelValid} confident answers, the validator overturned ${validatorRejectedAModelValid} of them ` +
      `(${modelValid ? Math.round((validatorRejectedAModelValid / modelValid) * 100) : 0}%).`,
  );
}

main();
