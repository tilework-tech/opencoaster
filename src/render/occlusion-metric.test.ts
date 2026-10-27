import { describe, expect, it } from 'vitest';
import { scoreOcclusion } from './occlusion-metric';

const kinds = new Map<number, string>([
  [1, 'ground'],
  [2, 'water'],
  [3, 'guest'],
  [4, 'tree'],
]);
const bit = (kind: string): number => 1 << ['ground', 'water', 'guest', 'tree'].indexOf(kind);

describe('scoreOcclusion', () => {
  it('counts object pixels the renderer gives to the wrong object, by oracle and rendered kind', () => {
    // Four pixels: guest over tree (correct), tree drawn over guest (wrong), ground correctly over
    // a hidden guest, guest drawn over the ground that should hide it.
    const oracle = Int32Array.from([3, 3, 1, 1]);
    const rendered = Int32Array.from([3, 4, 1, 3]);
    const masks = Uint32Array.from([
      bit('guest') | bit('tree'),
      bit('guest') | bit('tree'),
      bit('ground') | bit('guest'),
      bit('ground') | bit('guest'),
    ]);
    const score = scoreOcclusion({ oracle, rendered, kindMasks: masks, kinds, kindBit: bit });
    expect(score.objectPixels).toBe(3);
    expect(score.mismatched).toBe(2);
    expect(score.pairs['guest>tree']).toMatchObject({ mismatched: 1, contested: 2 });
    expect(score.pairs['ground>guest']).toMatchObject({ mismatched: 1, contested: 2 });
  });

  it('separates pixels where the rendered object does not cover the pixel at all', () => {
    const oracle = Int32Array.from([0, 1]);
    const rendered = Int32Array.from([3, 1]);
    const masks = Uint32Array.from([0, bit('ground')]);
    const score = scoreOcclusion({ oracle, rendered, kindMasks: masks, kinds, kindBit: bit });
    expect(score.mismatched).toBe(0);
    expect(score.coverage).toBe(1);
  });

  it('ignores ground drawn where the oracle has nothing, such as outside the map', () => {
    const score = scoreOcclusion({
      oracle: Int32Array.from([0]),
      rendered: Int32Array.from([1]),
      kindMasks: Uint32Array.from([0]),
      kinds,
      kindBit: bit,
    });
    expect(score.objectPixels).toBe(0);
    expect(score.mismatched + score.coverage).toBe(0);
  });
});
