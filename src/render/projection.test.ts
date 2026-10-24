import { describe, expect, it } from 'vitest';
import { project, rotateTile, unrotateTile } from './projection';
import type { Rotation } from './projection';

describe('projection', () => {
  it('unrotateTile inverts rotateTile for every rotation on a non-square map', () => {
    for (const rot of [0, 1, 2, 3] as Rotation[]) {
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 3; y++) {
          const [rx, ry] = rotateTile(x, y, 5, 3, rot);
          expect(unrotateTile(rx, ry, 5, 3, rot)).toEqual([x, y]);
        }
      }
    }
  });

  it('projects higher positions further up the screen', () => {
    const lo = new Float64Array(2);
    const hi = new Float64Array(2);
    project(256, 256, 0, 8, 8, 0, lo);
    project(256, 256, 128, 8, 8, 0, hi);
    expect(hi[1]).toBeLessThan(lo[1]);
    expect(hi[0]).toBe(lo[0]);
  });
});
