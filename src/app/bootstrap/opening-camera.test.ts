import { describe, expect, it } from 'vitest';
import { TILE_UNITS, Z_STEP } from '../../sim/core/constants';
import type { MapData } from '../../render/renderer';
import { project } from '../../render/projection';
import { scenarioOpeningPosition } from './opening-camera';

describe('scenario opening camera', () => {
  it('centres the gate and its contiguous footpath at each map edge and rotation', () => {
    const entrances = [
      { gate: [5, 2], inward: [0, 1] },
      { gate: [9, 7], inward: [-1, 0] },
      { gate: [5, 13], inward: [0, -1] },
      { gate: [2, 7], inward: [1, 0] },
    ] as const;
    for (const { gate, inward } of entrances) {
      const tiles = Array.from({ length: 4 }, (_, step) => [
        gate[0] + inward[0] * step,
        gate[1] + inward[1] * step,
      ]);
      const map: MapData = {
        width: 12,
        height: 16,
        heights: new Uint8Array(192).fill(2),
        surface: new Uint8Array(192),
        slope: new Uint8Array(192),
        entranceX: gate[0],
        entranceY: gate[1],
        pathElements: new Int32Array(tiles.flatMap(([x, y]) => [x, y, 2, 0, 0, 0])),
        pathCount: tiles.length,
      };
      const tileX = tiles.reduce((sum, [x]) => sum + x + 0.5, 0) / tiles.length;
      const tileY = tiles.reduce((sum, [, y]) => sum + y + 0.5, 0) / tiles.length;
      for (const rotation of [0, 1, 2, 3] as const) {
        const expected = new Float64Array(2);
        project(tileX * TILE_UNITS, tileY * TILE_UNITS, 2 * Z_STEP, 12, 16, rotation, expected);
        expect(scenarioOpeningPosition(map, rotation)).toEqual([expected[0], expected[1]]);
      }
    }
  });

  it('falls back to the map centre when no entrance is present', () => {
    expect(
      scenarioOpeningPosition(
        {
          width: 64,
          height: 48,
          heights: new Uint8Array(64 * 48),
          surface: new Uint8Array(64 * 48),
          slope: new Uint8Array(64 * 48),
        },
        0,
      ),
    ).toEqual([256, 896]);
  });

  it('does not drift past the entrance when its path connects to park roads', () => {
    const tiles = Array.from({ length: 8 }, (_, step) => [9 - step, 7]);
    const map: MapData = {
      width: 12,
      height: 16,
      heights: new Uint8Array(192).fill(2),
      surface: new Uint8Array(192),
      slope: new Uint8Array(192),
      entranceX: 9,
      entranceY: 7,
      pathElements: new Int32Array(tiles.flatMap(([x, y]) => [x, y, 2, 0, 0, 0])),
      pathCount: tiles.length,
    };
    const openingTiles = tiles.slice(0, 4);
    const tileX = openingTiles.reduce((sum, [x]) => sum + x + 0.5, 0) / openingTiles.length;
    const tileY = openingTiles.reduce((sum, [, y]) => sum + y + 0.5, 0) / openingTiles.length;
    const expected = new Float64Array(2);
    project(tileX * TILE_UNITS, tileY * TILE_UNITS, 2 * Z_STEP, 12, 16, 0, expected);

    expect(scenarioOpeningPosition(map, 0)).toEqual([expected[0], expected[1]]);
  });
});
