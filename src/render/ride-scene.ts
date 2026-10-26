import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { rideFootprintTiles } from '../sim/rides/ride-footprint';
import { RideInfo, RIDE_INFO_STRIDE } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import type { MapData } from './renderer';
import { rotateFootprint } from './projection';
import type { Rotation } from './projection';
import { rideCellSpriteKey } from './world-art';

/** Tiles beyond its footprint that a flat ride's art can reach (see `OVERHANG` in tools/sprites/ride-cells.ts). */
const SLICE_OVERHANG = 3;

/** One tile-sized slice of a flat ride: the atlas key anchored at world (x, y, z). */
export interface RideCellDraw {
  key: string;
  rideId: number;
  /** Ride phase, which selects the animation frame of the slice. */
  phase: number;
  x: number;
  y: number;
  z: number;
  depth: number;
}

/** Whether a ride type is drawn as per-tile slices (non-track gentle and thrill rides). */
export function isSlicedRide(type: RideType): boolean {
  const def = RIDE_CATALOG[type];
  return (
    def !== undefined &&
    !def.usesTrack &&
    def.id !== RideType.GoKarts &&
    def.footprint.length > 0 &&
    (def.category === 'gentle' || def.category === 'thrill')
  );
}

/**
 * Draw list of every flat ride's footprint slices for one snapshot. Each slice sorts with the
 * painter depth of its own tile (the convention guests, scenery and paths already use), so
 * things standing in front of or behind part of a large ride are layered correctly.
 */
export class RideCellScene {
  readonly items: RideCellDraw[] = [];
  /**
   * Per map tile, the floor level plus one of a flat ride whose footprint stands on or lies within
   * three tiles of the tile, else 0; valid after `build`. Terrain at or below that floor never hides the ride.
   */
  floor: Uint8Array = new Uint8Array(0);
  private count = 0;

  get length(): number {
    return this.count;
  }

  reset(): void {
    this.count = 0;
    this.floor.fill(0);
  }

  build(snapshot: Snapshot, map: MapData, rotation: Rotation): void {
    this.count = 0;
    if (this.floor.length !== map.width * map.height)
      this.floor = new Uint8Array(map.width * map.height);
    else this.floor.fill(0);
    for (let i = 0; i < snapshot.rides.count; i++) {
      const o = i * RIDE_INFO_STRIDE;
      const type = snapshot.rideInfo[o + RideInfo.Type] as RideType;
      if (!isSlicedRide(type)) continue;
      const def = RIDE_CATALOG[type];
      const dir = snapshot.rideInfo[o + RideInfo.Dir];
      const base = snapshot.rideInfo[o + RideInfo.BaseLevel];
      const phase = snapshot.rideInfo[o + RideInfo.Phase];
      const tiles = rideFootprintTiles(
        def,
        snapshot.rideInfo[o + RideInfo.RideX],
        snapshot.rideInfo[o + RideInfo.RideY],
        dir,
      );
      const view = rotateFootprint(0, 0, tiles, map.width, map.height, rotation).cells;
      for (let cell = 0; cell < tiles.length; cell++) {
        const [tx, ty] = tiles[cell];
        if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
        this.raiseFloor(map, tx, ty, base);
        const x = tx * TILE_UNITS + TILE_UNITS / 2;
        const y = ty * TILE_UNITS + TILE_UNITS / 2;
        const [rx, ry] = view[cell];
        const depth = 2 * (rx + ry + 1) - base;
        this.push(
          rideCellSpriteKey(type, cell, dir, rotation),
          snapshot.rideInfo[o + RideInfo.Id]!,
          phase,
          x,
          y,
          base * Z_STEP,
          depth,
        );
      }
    }
  }

  private raiseFloor(map: MapData, tx: number, ty: number, base: number): void {
    for (let dy = -SLICE_OVERHANG; dy <= SLICE_OVERHANG; dy++)
      for (let dx = -SLICE_OVERHANG; dx <= SLICE_OVERHANG; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
        const i = y * map.width + x;
        this.floor[i] = Math.max(this.floor[i], base + 1);
      }
  }

  private push(
    key: string,
    rideId: number,
    phase: number,
    x: number,
    y: number,
    z: number,
    depth: number,
  ): void {
    let item = this.items[this.count];
    if (!item) {
      item = { key, rideId, phase, x, y, z, depth };
      this.items.push(item);
    } else {
      item.key = key;
      item.rideId = rideId;
      item.phase = phase;
      item.x = x;
      item.y = y;
      item.z = z;
      item.depth = depth;
    }
    this.count++;
  }
}
