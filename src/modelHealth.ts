// When the local model keeps failing, stop asking it for a while.
//
// Every order tries the free local model first. When Ollama is down, hung
// or out of memory, each order used to wait for local to fail before
// trying Fireworks — every single time. After FAILURES_TO_PAUSE failures in
// a row, local is skipped for PAUSE_MS and orders go straight to Fireworks;
// then local is tried again, and one success puts it back in charge.
//
// Only HEALTH failures count (not reachable, timed out, broken output).
// A message the trust layer refused says nothing about whether the model
// is up, so it neither counts nor resets.

export const FAILURES_TO_PAUSE = 3;
export const PAUSE_MS = 10 * 60 * 1000;

export class ModelHealth {
  private failures = 0;
  private pausedUntil = 0;

  constructor(
    private readonly failuresToPause = FAILURES_TO_PAUSE,
    private readonly pauseMs = PAUSE_MS,
  ) {}

  isPaused(now = Date.now()): boolean {
    return now < this.pausedUntil;
  }

  pausedUntilTime(): number {
    return this.pausedUntil;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.pausedUntil = 0;
  }

  // True when this failure is the one that pauses the model.
  recordFailure(now = Date.now()): boolean {
    this.failures++;
    if (this.failures < this.failuresToPause) return false;
    this.failures = 0;
    this.pausedUntil = now + this.pauseMs;
    return true;
  }
}

// Not reachable, timed out, HTTP error or unreadable output — the model's
// fault, not the message's.
export function isHealthFailure(err: unknown): boolean {
  const e = err as Error;
  if (e?.name === "TypeError" || e?.name === "AbortError" || e?.name === "TimeoutError") return true;
  return /local model (unavailable|timed out|returned invalid json)|fetch failed|econnrefused|econnreset|timed out/i.test(
    e?.message ?? "",
  );
}
