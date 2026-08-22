// The parser can throw for two fundamentally different reasons, and the
// eval harness was treating them identically:
//
//   1. A legitimate business-logic clarification (structuredOrder.ts /
//      trustLayer.ts deciding the order is ambiguous/incomplete) — this IS
//      the parser's judgment, and is what CORRECTLY_CLARIFIED /
//      UNNECESSARILY_CLARIFIED are meant to measure.
//   2. An infrastructure failure (Ollama/Fireworks unreachable, malformed
//      HTTP response, missing API key, network error) — this has nothing
//      to do with the parser's judgment on the message. Counting it as a
//      "clarification" either inflates CORRECTLY_CLARIFIED with cases that
//      never actually got evaluated, or blames UNNECESSARILY_CLARIFIED on
//      the model when the real cause was the server being unreachable.
//
// Both currently surface as plain `Error` with no shared base class, so
// classification here is done by matching the known infra-failure message
// text thrown in localAiParser.ts / cloudAiParser.ts, plus generic network
// failure signatures that would come from a raw fetch() rejection.
const INFRA_ERROR_PATTERNS: RegExp[] = [
  /local model unavailable/i,
  /is ollama running/i,
  /local model returned invalid json/i,
  /cloud model unavailable/i,
  /cloud model returned no content/i,
  /cloud model returned invalid json/i,
  /fireworks_api_key is not set/i,
  /fetch failed/i,
  /econnrefused/i,
  /enotfound/i,
  /etimedout/i,
];

export function isInfraError(message: string): boolean {
  return INFRA_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}
