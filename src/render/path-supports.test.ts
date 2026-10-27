import { describe, expect, it } from 'vitest';
import { lowestPathBases, pathSupports } from './world-art';
import type { MapData } from './renderer';

describe('pathSupports', () => {
  it('has none for a footpath resting on the ground', () => {
    expect(pathSupports(3, 3, 3)).toEqual([]);
  });

  it('stands a footing and one column per level under a raised footpath', () => {
    const supports = pathSupports(2, 5, 5);
    expect(supports.filter((s) => s.sprite.endsWith('/column')).map((s) => s.level)).toEqual([
      2, 3,
    ]);
    expect(supports.filter((s) => s.sprite.endsWith('/cap')).map((s) => s.level)).toEqual([4]);
    expect(supports.filter((s) => s.sprite.endsWith('/base')).map((s) => s.level)).toEqual([2]);
  });

  it('draws path-specific sprites in the colours of the surface, never coaster art', () => {
    for (const surface of ['tarmac', 'crazy-paving', 'dirt', 'queue'] as const) {
      const sprites = pathSupports(0, 3, 3, surface).map((s) => s.sprite);
      expect(sprites.every((s) => s.startsWith('paths/support/'))).toBe(true);
      expect(sprites).toContain(`paths/support/${surface}/cap`);
    }
  });

  it('has none for the upper footpath of a bridge, whose tile has a path below it', () => {
    expect(pathSupports(2, 6, 2)).toEqual([]);
  });
});

describe('lowestPathBases', () => {
  it('records the lowest footpath base of each tile', () => {
    const map = {
      width: 4,
      height: 4,
      pathCount: 3,
      pathElements: new Int32Array([1, 1, 6, 0, 0, 0, 1, 1, 2, 0, 0, 0, 2, 1, 4, 0, 0, 0]),
    } as unknown as MapData;
    const lowest = lowestPathBases(map);
    expect(lowest[1 * 4 + 1]).toBe(2);
    expect(lowest[1 * 4 + 2]).toBe(4);
    expect(lowest[0]).toBe(255);
  });
});
