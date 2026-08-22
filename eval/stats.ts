export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx]!;
}

export interface LatencySummary {
  avg: number;
  p50: number;
  p95: number;
}

export function summarizeLatencies(latencies: number[]): LatencySummary {
  if (latencies.length === 0) return { avg: 0, p50: 0, p95: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const avg = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
  return { avg: Math.round(avg), p50: percentile(sorted, 50), p95: percentile(sorted, 95) };
}
