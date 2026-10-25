import { describe, expect, it } from 'vitest';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { rideFootprintTiles } from '../sim/rides/ride-footprint';
import {
  rideCellSpriteKey,
  rideCellView,
  rideHutFacing,
  rideHutFacingForFootprint,
  rideSpriteName,
} from './world-art';

const FLAT_RIDES = Object.values(RIDE_CATALOG).filter(
  (def) => !def.usesTrack && (def.category === 'gentle' || def.category === 'thrill'),
);

describe('flat ride footprint cells', () => {
  it('names a slice by the ride slug, the combined view and the unrotated footprint index', () => {
    expect(rideCellSpriteKey(RideType.MerryGoRound, 4, 0, 0)).toBe(
      'rides/flat/merry-go-round/view-0/cell-4',
    );
    expect(rideCellSpriteKey(RideType.MerryGoRound, 4, 1, 2)).toBe(
      'rides/flat/merry-go-round/view-3/cell-4',
    );
    expect(rideCellSpriteKey(RideType.Enterprise, 15, 3, 3)).toBe(
      'rides/flat/enterprise/view-2/cell-15',
    );
  });

  it('combines ride orientation and camera rotation modulo four', () => {
    for (let dir = -4; dir < 8; dir++)
      for (let rotation = 0; rotation < 4; rotation++)
        expect(rideCellView(rotation, dir)).toBe((((rotation + dir) % 4) + 4) % 4);
  });

  it('stays under the ride sprite group so the lazy flat-ride atlas category serves it', () => {
    for (const def of FLAT_RIDES)
      expect(rideCellSpriteKey(def.id, 0, 0, 0).startsWith(`${rideSpriteName(def.id)}/`)).toBe(true);
  });
});

describe('entrance and exit hut facing', () => {
  it('faces a hut toward the footprint tile it touches, whatever the orientation', () => {
    for (const def of FLAT_RIDES)
      for (let dir = 0; dir < 4; dir++) {
        const tiles = rideFootprintTiles(def, 10, 10, dir);
        const covered = new Set(tiles.map(([x, y]) => `${x},${y}`));
        for (const [tx, ty] of tiles)
          for (const [dx, dy, facing] of [
            [1, 0, 0],
            [0, 1, 1],
            [-1, 0, 2],
            [0, -1, 3],
          ] as const) {
            const px = tx + dx;
            const py = ty + dy;
            if (covered.has(`${px},${py}`)) continue;
            expect(rideHutFacingForFootprint(def.id, 10, 10, dir, px, py), def.name).toBe(facing);
          }
      }
  });

  it('keeps the single-tile facing for stalls and track rides', () => {
    for (const type of [RideType.FoodStall, RideType.SteelLoopingCoaster, RideType.GoKarts])
      for (const [px, py] of [
        [6, 5],
        [5, 6],
        [4, 5],
        [5, 4],
      ])
        expect(rideHutFacingForFootprint(type, 5, 5, 0, px, py)).toBe(
          rideHutFacing(5, 5, px, py),
        );
  });
});
