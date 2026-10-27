import type { World } from '../core/world';
import { firstOccupancyBlocker, worldOccupancies } from '../map/occupancy';
import { Z_STEP } from '../core/constants';

/** Park-level state owned by the guest module: where guests enter and leave. */
export interface ParkState {
  /** Gate tile coordinates; -1 while the park has no entrance. */
  entranceX: number;
  entranceY: number;
}

export function createParkState(): ParkState {
  return { entranceX: -1, entranceY: -1 };
}

export function hasParkEntrance(world: World): boolean {
  return world.park.entranceX >= 0;
}

/** Tile index of the gate, or -1 when none is set. */
export function parkEntranceTile(world: World): number {
  const park = world.park;
  return park.entranceX < 0 ? -1 : world.map.index(park.entranceX, park.entranceY);
}

/** The gate must stand on a footpath, otherwise guests could neither enter nor leave. */
export function setParkEntrance(world: World, x: number, y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !world.map.inBounds(x, y)) return false;
  if (!world.map.isWalkable(world.map.index(x, y))) return false;
  const tile = world.map.index(x, y);
  const base = world.map.heights[tile] * Z_STEP;
  if (
    firstOccupancyBlocker(
      [
        {
          tileX: x,
          tileY: y,
          base,
          clearance: base + 2 * Z_STEP,
          kind: 'parkEntrance',
          name: 'Park entrance',
        },
      ],
      worldOccupancies(world),
      'Park entrance',
    )
  )
    return false;
  world.park.entranceX = x;
  world.park.entranceY = y;
  return true;
}
