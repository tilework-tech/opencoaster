import { describe, expect, it } from 'vitest';
import { rideGhostSprites } from './track-preview';
import type { RidePlacementGhost } from './track-preview';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { rideFootprintTiles } from '../sim/rides/ride-footprint';
import type { MapData } from '../render/renderer';

const map = { width: 12, height: 12, heights: new Uint8Array(144).fill(3) } as unknown as MapData;

function ghost(overrides: Partial<RidePlacementGhost>): RidePlacementGhost {
  return {
    type: RideType.MerryGoRound,
    x: 4,
    y: 5,
    dir: 0,
    baseLevel: 3,
    facing: 0,
    valid: true,
    ...overrides,
  };
}

describe('ride placement sprites', () => {
  it('covers every footprint tile of a flat ride, at the ride floor level', () => {
    for (const dir of [0, 1, 2, 3]) {
      const sprites = rideGhostSprites(ghost({ dir, baseLevel: 5 }), map, 0);
      const tiles = rideFootprintTiles(RIDE_CATALOG[RideType.MerryGoRound], 4, 5, dir);
      expect(sprites.map((s) => [s.x, s.y])).toEqual(tiles);
      expect(sprites.every((s) => s.level === 5 && s.kind === 'ride')).toBe(true);
    }
  });

  it('marks invalid spots refused on every slice', () => {
    const sprites = rideGhostSprites(ghost({ valid: false }), map, 0);
    expect(sprites).toHaveLength(9);
    expect(sprites.every((s) => s.tone === 'refused')).toBe(true);
  });

  it('shows different slice sprites for each camera rotation', () => {
    const keys = [0, 1, 2, 3].map((rotation) =>
      rideGhostSprites(ghost({}), map, rotation as 0 | 1 | 2 | 3)
        .map((s) => s.sprite)
        .join(','),
    );
    expect(new Set(keys).size).toBe(4);
  });

  it('draws only the footprint tiles that lie inside the map', () => {
    const sprites = rideGhostSprites(ghost({ x: 11, y: 5 }), map, 0);
    expect(sprites.length).toBeLessThan(9);
    expect(sprites.every((s) => s.x < 12)).toBe(true);
  });

  it('keeps a single sprite for a stall on its own tile level', () => {
    const sprites = rideGhostSprites(ghost({ type: RideType.FoodStall, x: 2, y: 3 }), map, 0);
    expect(sprites).toHaveLength(1);
    expect(sprites[0]).toMatchObject({ x: 2, y: 3, level: 3, kind: 'ride' });
  });
});
