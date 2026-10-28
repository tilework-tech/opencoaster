import type { World } from '../core/world';
import { firstOccupancyBlocker, worldOccupancies } from '../map/occupancy';
import { Z_STEP } from '../core/constants';

export interface PeepSpawn {
  x: number;
  y: number;
}

/** Most spawn points a park can have. */
export const MAX_PEEP_SPAWNS = 2;

/** Park-level state owned by the guest module: where guests enter and leave. */
export interface ParkState {
  /** Gate tile coordinates; -1 while the park has no entrance. */
  entranceX: number;
  entranceY: number;
  /** Path tiles on the map edge where arriving guests appear. */
  spawns: PeepSpawn[];
}

export function createParkState(): ParkState {
  return { entranceX: -1, entranceY: -1, spawns: [] };
}

/**
 * Where new guests appear: the park's spawn points, or the gate for parks that predate them.
 * Empty when the park has neither, in which case nobody arrives.
 */
export function spawnPoints(world: World): readonly PeepSpawn[] {
  const park = world.park;
  if (park.spawns.length > 0) return park.spawns;
  return hasParkEntrance(world) ? [{ x: park.entranceX, y: park.entranceY }] : [];
}

/** Adds a spawn point on a footpath tile at the map edge; false when the tile cannot take one. */
export function addPeepSpawn(world: World, x: number, y: number): boolean {
  const m = world.map;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !m.inBounds(x, y)) return false;
  if (x !== 0 && y !== 0 && x !== m.width - 1 && y !== m.height - 1) return false;
  if (!m.isWalkable(m.index(x, y))) return false;
  const spawns = world.park.spawns;
  if (spawns.some((s) => s.x === x && s.y === y) || spawns.length >= MAX_PEEP_SPAWNS) return false;
  spawns.push({ x, y });
  return true;
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
