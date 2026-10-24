import { describe, expect, it } from 'vitest';
import { Prng } from './prng';

describe('Prng', () => {
  it('is deterministic per seed', () => {
    const a = new Prng(42);
    const b = new Prng(42);
    for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('differs between seeds', () => {
    expect(new Prng(1).nextU32()).not.toBe(new Prng(2).nextU32());
  });

  it('int(n) stays in [0, n)', () => {
    const r = new Prng(5);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it('covers the range roughly uniformly', () => {
    const r = new Prng(9);
    const buckets = new Array(4).fill(0);
    for (let i = 0; i < 4000; i++) buckets[r.int(4)]++;
    for (const b of buckets) expect(b).toBeGreaterThan(800);
  });
});
