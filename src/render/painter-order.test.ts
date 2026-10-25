import { describe, expect, it } from 'vitest';
import { sortByDepth } from './painter-order';

function referenceOrder(keys: number[]): number[] {
  return keys
    .map((key, index) => ({ key, index }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
    .map((entry) => entry.index);
}

describe('sortByDepth', () => {
  it('orders indices by ascending depth key', () => {
    const keys = Int32Array.from([5, 1, 9, 3]);
    const order = new Int32Array(4);
    sortByDepth(keys, 4, order);
    expect([...order]).toEqual([1, 3, 0, 2]);
  });

  it('keeps equal keys in insertion order', () => {
    const keys = Int32Array.from([2, 2, 1, 2, 1]);
    const order = new Int32Array(5);
    sortByDepth(keys, 5, order);
    expect([...order]).toEqual([2, 4, 0, 1, 3]);
  });

  it('handles negative keys and ignores entries past the count', () => {
    const keys = Int32Array.from([-4, 7, -10, 0, -999]);
    const order = new Int32Array(5);
    sortByDepth(keys, 4, order);
    expect([...order].slice(0, 4)).toEqual([2, 0, 3, 1]);
  });

  it('matches a comparator sort on a large pseudo-random input', () => {
    const count = 6000;
    const keys = new Int32Array(count);
    let seed = 12345;
    for (let i = 0; i < count; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) | 0;
      keys[i] = ((seed >>> 8) % 700) - 150;
    }
    const order = new Int32Array(count);
    sortByDepth(keys, count, order);
    expect([...order]).toEqual(referenceOrder([...keys]));
  });

  it('does nothing for an empty input', () => {
    const order = new Int32Array(0);
    expect(() => sortByDepth(new Int32Array(0), 0, order)).not.toThrow();
  });
});
