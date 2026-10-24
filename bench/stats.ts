export function nearestRankPercentile(samples: readonly number[], percentile: number): number {
  if (samples.length === 0) throw new RangeError('percentiles require at least one sample');
  if (!Number.isFinite(percentile) || percentile < 0 || percentile > 1) {
    throw new RangeError('percentile must be between 0 and 1');
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[rank - 1];
}

export function withinBudget(measurement: number, budget: number): boolean {
  return measurement <= budget;
}
