import { describe, expect, it } from 'vitest';
import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { rideFootprintTiles } from '../sim/rides/ride-footprint';
import { RideInfo, RIDE_INFO_STRIDE, createSnapshot } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import { project } from './projection';
import type { Rotation } from './projection';
import { isSlicedRide, RideCellScene } from './ride-scene';
import { rideCellSpriteKey } from './world-art';
import type { MapData } from './renderer';

const SIZE = 30;

function map(): MapData {
  return {
    width: SIZE,
    height: SIZE,
    heights: new Uint8Array(SIZE * SIZE),
    surface: new Uint8Array(SIZE * SIZE),
    slope: new Uint8Array(SIZE * SIZE),
    waterLevel: new Uint8Array(SIZE * SIZE),
  };
}

function snapshotWith(
  rides: Array<{ type: RideType; x: number; y: number; dir: number; base: number }>,
): Snapshot {
  const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });
  rides.forEach((ride, index) => {
    const o = index * RIDE_INFO_STRIDE;
    snapshot.rideInfo[o + RideInfo.Id] = 100 + index;
    snapshot.rideInfo[o + RideInfo.Type] = ride.type;
    snapshot.rideInfo[o + RideInfo.RideX] = ride.x;
    snapshot.rideInfo[o + RideInfo.RideY] = ride.y;
    snapshot.rideInfo[o + RideInfo.Dir] = ride.dir;
    snapshot.rideInfo[o + RideInfo.BaseLevel] = ride.base;
  });
  snapshot.rides.count = rides.length;
  return snapshot;
}

describe('RideCellScene', () => {
  it('retains ride identity and a unique slice for every tile of every flat ride', () => {
    const scene = new RideCellScene();
    const m = map();
    const flatRides = Object.values(RIDE_CATALOG).filter((definition) =>
      isSlicedRide(definition.id),
    );

    expect(flatRides.length).toBeGreaterThan(0);
    for (const definition of flatRides) {
      const rideId = 100;
      scene.build(snapshotWith([{ type: definition.id, x: 12, y: 14, dir: 0, base: 3 }]), m, 0);

      expect(scene.length, definition.name).toBe(definition.footprint.length);
      const activeItems = scene.items.slice(0, scene.length);
      expect(
        activeItems.map((item) => item.rideId),
        definition.name,
      ).toEqual(Array.from({ length: definition.footprint.length }, () => rideId));
      expect(new Set(activeItems.map((item) => item.key)).size, definition.name).toBe(
        definition.footprint.length,
      );
      scene.reset();
    }
  });

  it('draws one slice per footprint tile at the centre of the tile it covers', () => {
    const scene = new RideCellScene();
    const m = map();
    for (let dir = 0; dir < 4; dir++)
      for (let rotation = 0 as Rotation; rotation < 4; rotation = (rotation + 1) as Rotation) {
        scene.build(
          snapshotWith([{ type: RideType.SwingingShip, x: 12, y: 14, dir, base: 3 }]),
          m,
          rotation,
        );
        const def = RIDE_CATALOG[RideType.SwingingShip];
        const tiles = rideFootprintTiles(def, 12, 14, dir);
        expect(scene.length).toBe(def.footprint.length);
        for (let i = 0; i < scene.length; i++) {
          const item = scene.items[i];
          const index = def.footprint.findIndex(
            (_, cell) => item.key === rideCellSpriteKey(def.id, cell, dir, rotation),
          );
          expect(index).toBeGreaterThanOrEqual(0);
          expect(item.x).toBe(tiles[index][0] * TILE_UNITS + TILE_UNITS / 2);
          expect(item.y).toBe(tiles[index][1] * TILE_UNITS + TILE_UNITS / 2);
          expect(item.z).toBe(3 * Z_STEP);
        }
      }
  });

  it('sorts slices by tile depth so tiles nearer the camera draw later, in every rotation', () => {
    const scene = new RideCellScene();
    const m = map();
    for (let rotation = 0 as Rotation; rotation < 4; rotation = (rotation + 1) as Rotation) {
      scene.build(
        snapshotWith([{ type: RideType.MerryGoRound, x: 10, y: 10, dir: 1, base: 0 }]),
        m,
        rotation,
      );
      const out = new Float64Array(2);
      for (let a = 0; a < scene.length; a++)
        for (let b = 0; b < scene.length; b++) {
          const first = scene.items[a];
          const second = scene.items[b];
          project(first.x, first.y, 0, SIZE, SIZE, rotation, out);
          const sumA = out[1];
          project(second.x, second.y, 0, SIZE, SIZE, rotation, out);
          if (sumA < out[1]) expect(first.depth).toBeLessThan(second.depth);
        }
    }
  });

  it('ignores stalls, track rides and rides placed off the map', () => {
    const scene = new RideCellScene();
    scene.build(
      snapshotWith([
        { type: RideType.FoodStall, x: 5, y: 5, dir: 0, base: 0 },
        { type: RideType.SteelLoopingCoaster, x: 8, y: 8, dir: 0, base: 0 },
        { type: RideType.MerryGoRound, x: -3, y: 4, dir: 0, base: 0 },
      ]),
      map(),
      0,
    );
    expect(scene.length).toBe(0);
  });
});
