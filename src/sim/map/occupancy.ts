import type { World } from '../core/world';
import { TRACK_Z_STEP, Z_STEP } from '../core/constants';
import { RIDE_CATALOG, RideType } from '../rides/ride-types';
import { DEFAULT_TOWER_HEIGHT } from '../rides/observation-tower';
import { PIECES } from '../track/catalog';
import { ElementType, PathFlag } from './tile-map';
import { PATH_ENTRANCE_MARK, PATH_EXIT_MARK } from './tile-map';
import { SCENERY_CATALOG, SceneryCategory } from './scenery';
import {
  BOARDING_CLEARANCE_WORLD,
  PARK_ENTRANCE_CLEARANCE_WORLD,
  RIDE_CLEARANCE_WORLD,
  TRACK_CLEARANCE_WORLD,
} from './occupancy-constants';

/** Kinds used for obstruction messages and the small set of construction exceptions. */
export type OccupancyKind =
  | 'track'
  | 'station'
  | 'flatRide'
  | 'facility'
  | 'rideEntrance'
  | 'rideExit'
  | 'path'
  | 'queue'
  | 'scenery'
  | 'wall'
  | 'parkEntrance'
  | 'terrain';

/** One tile or edge of an element's occupied volume. Heights are world units, top exclusive. */
export interface OccupancyVolume {
  tileX: number;
  tileY: number;
  base: number;
  clearance: number;
  kind: OccupancyKind;
  name: string;
  /** Bit 0..3 are the occupied tile edges. Omit for a full-tile footprint. */
  edgeMask?: number;
  /** True only for a supported flat, ordinary track/path crossing. */
  levelCrossing?: boolean;
}

/** RCT-style half-open vertical interval and tile-edge overlap test. */
export function occupancyConflict(a: OccupancyVolume, b: OccupancyVolume): boolean {
  if (a.tileX !== b.tileX || a.tileY !== b.tileY) return false;
  if (a.edgeMask !== undefined && b.edgeMask !== undefined && !(a.edgeMask & b.edgeMask))
    return false;
  if (!(a.base < b.clearance && a.clearance > b.base)) return false;
  const trackPath =
    (a.kind === 'track' && b.kind === 'path') || (a.kind === 'path' && b.kind === 'track');
  if (
    trackPath &&
    a.levelCrossing &&
    b.levelCrossing &&
    a.base === b.base &&
    a.kind !== 'queue' &&
    b.kind !== 'queue'
  )
    return false;
  const aPath = a.kind === 'path' || a.kind === 'queue';
  const bPath = b.kind === 'path' || b.kind === 'queue';
  const pathBoarding =
    (aPath && (b.kind === 'rideEntrance' || b.kind === 'rideExit' || b.kind === 'parkEntrance')) ||
    (bPath && (a.kind === 'rideEntrance' || a.kind === 'rideExit' || a.kind === 'parkEntrance')) ||
    (a.kind === 'wall' && bPath) ||
    (b.kind === 'wall' && aPath);
  const gateBoarding =
    (a.kind === 'parkEntrance' && (b.kind === 'rideEntrance' || b.kind === 'rideExit')) ||
    (b.kind === 'parkEntrance' && (a.kind === 'rideEntrance' || a.kind === 'rideExit'));
  if ((pathBoarding || gateBoarding) && a.base === b.base) return false;
  return true;
}

function rotate(x: number, y: number, dir: number): [number, number] {
  switch (dir & 3) {
    case 0:
      return [x, y];
    case 1:
      return [-y, x];
    case 2:
      return [-x, -y];
    default:
      return [y, -x];
  }
}

function rideName(world: World, id: number): string {
  const slot = world.rides.idToSlot[id];
  const type = slot >= 0 ? world.rides.cols.typeId[slot] : -1;
  return `${RIDE_CATALOG[type as RideType]?.name ?? 'Ride'} ${id + 1}`;
}

/** Returns the placed ride's track clearance, falling back for non-RCT2 ride definitions. */
export function trackClearanceForRide(world: World, id: number): number {
  const slot = world.rides.idToSlot[id];
  const type = slot >= 0 ? world.rides.cols.typeId[slot] : -1;
  return RIDE_CATALOG[type as RideType]?.trackClearanceWorld ?? TRACK_CLEARANCE_WORLD;
}

/** Builds the live placed-element index from authoritative sim state. */
export function worldOccupancies(world: World): OccupancyVolume[] {
  const out: OccupancyVolume[] = [];
  const map = world.map;
  for (let tile = 0; tile < map.width * map.height; tile++) {
    const tileX = tile % map.width;
    const tileY = (tile / map.width) | 0;
    for (let e = map.firstElement(tile); e >= 0; e = map.nextElement(e)) {
      const type = map.elType[e];
      const isPath = type === ElementType.Path;
      const item = SCENERY_CATALOG[map.elData[e]];
      const wallScenery =
        type === ElementType.SmallScenery && item?.category === SceneryCategory.Fences;
      const markedEntrance = isPath && (map.elData[e] & PATH_ENTRANCE_MARK) !== 0;
      const markedExit = isPath && (map.elData[e] & PATH_EXIT_MARK) !== 0;
      out.push({
        tileX,
        tileY,
        base: map.elBase[e] * Z_STEP,
        clearance: map.elClear[e] * Z_STEP,
        kind: markedEntrance
          ? 'rideEntrance'
          : markedExit
            ? 'rideExit'
            : isPath && (map.elFlags[e] & PathFlag.Queue) !== 0
              ? 'queue'
              : type === ElementType.Path
                ? 'path'
                : type === ElementType.Wall || wallScenery
                  ? 'wall'
                  : type === ElementType.Entrance
                    ? 'parkEntrance'
                    : 'scenery',
        name:
          markedEntrance || markedExit
            ? `Ride ${map.elData[e] & PATH_ENTRANCE_MARK ? 'entrance' : 'exit'}`
            : isPath
              ? 'Path'
              : wallScenery
                ? item.name
                : type === ElementType.Wall
                  ? 'Wall'
                  : 'Scenery',
        edgeMask: type === ElementType.Wall || wallScenery ? 1 << (map.elFlags[e] & 3) : undefined,
        levelCrossing: isPath && (map.elFlags[e] & (PathFlag.Queue | PathFlag.Sloped)) === 0,
      });
    }
  }

  const track = world.track.pieces;
  const tc = track.cols;
  for (let slot = 0; slot < track.count; slot++) {
    const def = PIECES[tc.pieceType[slot]];
    const trackClearance = trackClearanceForRide(world, tc.rideId[slot]);
    for (const cell of def.footprint) {
      const [dx, dy] = rotate(cell.i, cell.j, tc.dir[slot]);
      out.push({
        tileX: tc.x[slot] + dx,
        tileY: tc.y[slot] + dy,
        base: tc.z[slot] * TRACK_Z_STEP + cell.zMin,
        clearance: tc.z[slot] * TRACK_Z_STEP + cell.zMax + trackClearance,
        kind: def.shape === 'station' ? 'station' : 'track',
        name: rideName(world, tc.rideId[slot]),
        levelCrossing: def.shape === 'straight' && cell.zMin === 0 && cell.zMax === 0,
      });
    }
  }

  const rides = world.rides;
  const rc = rides.cols;
  for (let slot = 0; slot < rides.count; slot++) {
    const id = rides.slotToId[slot];
    const type = rc.typeId[slot] as RideType;
    const def = RIDE_CATALOG[type];
    if (!def) continue;
    if (!def.usesTrack) {
      const base = map.inBounds(rc.rideX[slot], rc.rideY[slot])
        ? map.heights[map.index(rc.rideX[slot], rc.rideY[slot])] * Z_STEP
        : 0;
      const height =
        type === RideType.ObservationTower
          ? (rc.towerHeight[slot] || DEFAULT_TOWER_HEIGHT) * Z_STEP
          : (def.clearanceWorld ?? RIDE_CLEARANCE_WORLD);
      for (const [dx, dy] of def.footprint) {
        const [rx, ry] = rotate(dx, dy, rc.dir[slot]);
        out.push({
          tileX: rc.rideX[slot] + rx,
          tileY: rc.rideY[slot] + ry,
          base,
          clearance: base + height,
          kind: def.category === 'stall' || def.category === 'facility' ? 'facility' : 'flatRide',
          name: rideName(world, id),
        });
      }
    }
    for (const [placed, x, y, kind] of [
      [rc.entrancePlaced[slot], rc.entranceX[slot], rc.entranceY[slot], 'rideEntrance'],
      [rc.exitPlaced[slot], rc.exitX[slot], rc.exitY[slot], 'rideExit'],
    ] as const) {
      if (!placed || !map.inBounds(x, y)) continue;
      const base = map.heights[map.index(x, y)] * Z_STEP;
      out.push({
        tileX: x,
        tileY: y,
        base,
        clearance: base + BOARDING_CLEARANCE_WORLD,
        kind,
        name: rideName(world, id),
      });
    }
  }

  if (world.park.entranceX >= 0 && map.inBounds(world.park.entranceX, world.park.entranceY)) {
    const tile = map.index(world.park.entranceX, world.park.entranceY);
    const base = map.heights[tile] * Z_STEP;
    out.push({
      tileX: world.park.entranceX,
      tileY: world.park.entranceY,
      base,
      clearance: base + PARK_ENTRANCE_CLEARANCE_WORLD,
      kind: 'parkEntrance',
      name: 'Park entrance',
    });
  }
  return out;
}

export function firstOccupancyBlocker(
  candidates: readonly OccupancyVolume[],
  existing: readonly OccupancyVolume[],
  ignoreName?: string,
): OccupancyVolume | undefined {
  for (const candidate of candidates) {
    for (const blocker of existing) {
      if (blocker.name !== ignoreName && occupancyConflict(candidate, blocker)) return blocker;
    }
  }
  return undefined;
}

/** Occupancy produced by a not-yet-placed ride, using its full rotated footprint. */
export function ridePlacementOccupancies(
  type: number,
  x: number,
  y: number,
  dir: number,
  base: number,
  towerHeight = DEFAULT_TOWER_HEIGHT,
): OccupancyVolume[] {
  const def = RIDE_CATALOG[type as RideType];
  if (!def) return [];
  const kind = def.category === 'stall' || def.category === 'facility' ? 'facility' : 'flatRide';
  const clearance =
    base +
    (type === RideType.ObservationTower
      ? towerHeight * Z_STEP
      : (def.clearanceWorld ?? RIDE_CLEARANCE_WORLD));
  return def.footprint.map(([dx, dy]) => {
    const [rx, ry] = rotate(dx, dy, dir);
    return {
      tileX: x + rx,
      tileY: y + ry,
      base,
      clearance,
      kind,
      name: `${def.name}`,
    };
  });
}

/** Ride names involved in legacy overlaps; this scan reports without changing the world. */
export function overlappingRideNames(world: World): string[] {
  const byTile = new Map<number, OccupancyVolume[]>();
  const rides = new Set<string>();
  for (const item of worldOccupancies(world)) {
    const key = item.tileY * world.map.width + item.tileX;
    const sameTile = byTile.get(key) ?? [];
    for (const other of sameTile) {
      if (item.name === other.name || !occupancyConflict(item, other)) continue;
      for (const volume of [item, other]) {
        if (
          volume.kind === 'track' ||
          volume.kind === 'station' ||
          volume.kind === 'flatRide' ||
          volume.kind === 'facility'
        )
          rides.add(volume.name);
      }
    }
    sameTile.push(item);
    byTile.set(key, sameTile);
  }
  return [...rides].sort();
}
