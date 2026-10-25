import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { rideFootprintTiles } from '../sim/rides/ride-footprint';
import { RideInfo, RIDE_INFO_STRIDE } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import { rotatedPositionSum } from './painter-order';
import type { MapData } from './renderer';
import type { Rotation } from './projection';
import { rideCellSpriteKey } from './world-art';

/** One tile-sized slice of a flat ride: the atlas key anchored at world (x, y, z). */
export interface RideCellDraw {
  key: string;
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
  private count = 0;

  get length(): number {
    return this.count;
  }

  reset(): void {
    this.count = 0;
  }

  build(snapshot: Snapshot, map: MapData, rotation: Rotation): void {
    this.count = 0;
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
      for (let cell = 0; cell < tiles.length; cell++) {
        const [tx, ty] = tiles[cell];
        if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
        const x = tx * TILE_UNITS + TILE_UNITS / 2;
        const y = ty * TILE_UNITS + TILE_UNITS / 2;
        const depth = 2 * rotatedPositionSum(x, y, map, rotation) - base;
        this.push(rideCellSpriteKey(type, cell, dir, rotation), phase, x, y, base * Z_STEP, depth);
      }
    }
  }

  private push(key: string, phase: number, x: number, y: number, z: number, depth: number): void {
    let item = this.items[this.count];
    if (!item) {
      item = { key, phase, x, y, z, depth };
      this.items.push(item);
    } else {
      item.key = key;
      item.phase = phase;
      item.x = x;
      item.y = y;
      item.z = z;
      item.depth = depth;
    }
    this.count++;
  }
}
