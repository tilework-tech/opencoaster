import { describe, expect, it } from 'vitest';
import { nearestRankPercentile, withinBudget } from './stats';

describe('benchmark statistics', () => {
  it('uses the nearest-rank percentile for a fixed set of tick samples', () => {
    const samples = Array.from({ length: 200 }, (_, index) => 200 - index);
    const original = [...samples];

    expect(nearestRankPercentile(samples, 0.5)).toBe(100);
    expect(nearestRankPercentile(samples, 0.95)).toBe(190);
    expect(nearestRankPercentile(samples, 0.99)).toBe(198);
    expect(samples).toEqual(original);
  });

  it('accepts a p99 at the budget and rejects one above it', () => {
    expect(withinBudget(8, 8)).toBe(true);
    expect(withinBudget(8.001, 8)).toBe(false);
  });

  it('rejects a non-finite percentile', () => {
    expect(() => nearestRankPercentile([1, 2, 3], Number.NaN)).toThrow(RangeError);
  });
});
