import { describe, expect, it } from 'vitest';
import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { rideFootprintTiles } from '../sim/rides/ride-footprint';
import { RideInfo, RIDE_INFO_STRIDE, createSnapshot } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import { project } from './projection';
import type { Rotation } from './projection';
import { rotatedPositionSum } from './painter-order';
import { RideCellScene } from './ride-scene';
import { rideCellSpriteKey } from './world-art';
import type { MapData } from './renderer';

const SIZE = 30;

function tileViewSum(x: number, y: number, m: MapData, rotation: Rotation): number {
  return rotatedPositionSum(x * TILE_UNITS, y * TILE_UNITS, m, rotation);
}

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

describe('RideCellScene floor', () => {
  it('marks the footprint and the tiles around it with the ride floor level plus one', () => {
    const scene = new RideCellScene();
    scene.build(
      snapshotWith([{ type: RideType.MerryGoRound, x: 12, y: 14, dir: 0, base: 3 }]),
      map(),
      0,
    );
    const at = (x: number, y: number): number => scene.floor[y * SIZE + x];
    for (const [x, y] of rideFootprintTiles(RIDE_CATALOG[RideType.MerryGoRound], 12, 14, 0))
      expect(at(x, y)).toBe(4);
    expect(at(14, 16)).toBe(4);
    expect(at(16, 16)).toBe(4);
    expect(at(18, 18)).toBe(0);
    scene.reset();
    expect(at(12, 14)).toBe(0);
  });
});

describe('RideCellScene', () => {
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

  it('orders guests in neighbouring tiles before or after a slice, in every rotation', () => {
    const scene = new RideCellScene();
    const m = map();
    const def = RIDE_CATALOG[RideType.TopSpin];
    const guestDepth = (x: number, y: number, rotation: Rotation): number =>
      2 * rotatedPositionSum(x, y, m, rotation);
    for (let rotation = 0 as Rotation; rotation < 4; rotation = (rotation + 1) as Rotation) {
      scene.build(
        snapshotWith([{ type: RideType.TopSpin, x: 12, y: 12, dir: 0, base: 0 }]),
        m,
        rotation,
      );
      for (let i = 0; i < scene.length; i++) {
        const slice = scene.items[i];
        const tx = Math.floor(slice.x / TILE_UNITS);
        const ty = Math.floor(slice.y / TILE_UNITS);
        const covered = rideFootprintTiles(def, 12, 12, 0).some(([x, y]) => x === tx && y === ty);
        expect(covered).toBe(true);
        for (const [dx, dy] of [
          [-1, 0],
          [0, -1],
          [1, 0],
          [0, 1],
          [-2, 1],
          [1, -2],
        ]) {
          const sumDelta =
            tileViewSum(tx + dx, ty + dy, m, rotation) - tileViewSum(tx, ty, m, rotation);
          if (sumDelta === 0) continue;
          for (const [fx, fy] of [
            [0.02, 0.02],
            [0.98, 0.02],
            [0.5, 0.5],
            [0.02, 0.98],
            [0.98, 0.98],
          ]) {
            const depth = guestDepth(
              (tx + dx + fx) * TILE_UNITS,
              (ty + dy + fy) * TILE_UNITS,
              rotation,
            );
            if (sumDelta < 0) expect(depth).toBeLessThanOrEqual(slice.depth);
            else expect(depth).toBeGreaterThanOrEqual(slice.depth);
          }
        }
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
