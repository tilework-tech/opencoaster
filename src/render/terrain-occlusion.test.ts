import { describe, expect, it } from 'vitest';
import type { MapData } from './renderer';
import { SOLID_BIAS, rotatedPositionSum } from './depth-key';
import type { Rotation } from './projection';
import { occluderDepth, sceneryDepth, tileRisesOverBehind } from './terrain-occlusion';

const ROTATIONS: Rotation[] = [0, 1, 2, 3];

function mapWithSlopeAt(x: number, y: number, mask: number): MapData {
  const map: MapData = {
    width: 5,
    height: 5,
    heights: new Uint8Array(25).fill(2),
    surface: new Uint8Array(25),
    slope: new Uint8Array(25),
  };
  map.slope[y * 5 + x] = mask;
  return map;
}

describe('terrain occlusion', () => {
  it('flags a sloped tile as rising over the flat tiles behind it in every view', () => {
    const map = mapWithSlopeAt(2, 2, 0b0110);
    for (const rotation of ROTATIONS) expect(tileRisesOverBehind(map, 2, 2, rotation)).toBe(true);
  });

  it('does not flag flat ground or the tiles in front of a rise', () => {
    const map = mapWithSlopeAt(2, 2, 0b0110);
    expect(tileRisesOverBehind(map, 1, 1, 0)).toBe(false);
    expect(tileRisesOverBehind(map, 3, 2, 0)).toBe(false);
    expect(tileRisesOverBehind(map, 2, 3, 0)).toBe(false);
  });

  it('keeps scenery on flat ground at its plain centre depth', () => {
    const map = mapWithSlopeAt(0, 0, 0);
    for (const rotation of ROTATIONS)
      expect(sceneryDepth(map, 2, 2, rotation, 2 * 64)).toBe(
        2 * rotatedPositionSum(2.5 * 256, 2.5 * 256, map, rotation) - 2 + SOLID_BIAS,
      );
  });

  it('sorts scenery on a rising tile after that tile redrawn as an occluder', () => {
    for (const mask of [0b0001, 0b0010, 0b0100, 0b1000, 0b0011, 0b0110, 0b1100, 0b1001])
      for (const rotation of ROTATIONS) {
        const map = mapWithSlopeAt(2, 2, mask);
        for (const groundZ of [2 * 64, 2 * 64 + 32, 3 * 64])
          expect(
            sceneryDepth(map, 2, 2, rotation, groundZ),
            `mask=${mask} rotation=${rotation} z=${groundZ}`,
          ).toBeGreaterThan(occluderDepth(map, 2, 2, rotation));
      }
  });

  it('still lets a raised tile in front of the scenery hide it', () => {
    const map = mapWithSlopeAt(2, 2, 0b0110);
    map.heights[3 * 5 + 2] = 4;
    map.heights[2 * 5 + 3] = 4;
    map.heights[3 * 5 + 3] = 4;
    for (const rotation of ROTATIONS) {
      const standing = sceneryDepth(map, 2, 2, rotation, 2 * 64 + 32);
      const nearer = [
        [3, 2],
        [2, 3],
        [1, 2],
        [2, 1],
      ]
        .filter(([x, y]) => tileRisesOverBehind(map, x!, y!, rotation))
        .map(([x, y]) => occluderDepth(map, x!, y!, rotation));
      for (const depth of nearer)
        if (depth > occluderDepth(map, 2, 2, rotation)) expect(standing).toBeLessThan(depth);
    }
  });
});
