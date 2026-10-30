import type { World } from '../core/world';
import type { TileMap } from '../map/tile-map';
import {
  DIR_DX,
  DIR_DY,
  ElementType,
  PATH_EXIT_MARK,
  PathFlag,
  WALK_LAYERS,
  pathEdgeLevel,
} from '../map/tile-map';
import { rideBaseLevel } from './ride-footprint';
import { RideResult } from './ride-results';
import { RIDE_CATALOG } from './ride-types';
import type { RideType } from './ride-types';

/**
 * A stall (shop, stall or facility) serves guests through one window on its front edge. `ride.dir`
 * is the direction that edge faces (0 = +x, 1 = +y, 2 = -x, 3 = -y), and the stall is reachable
 * only from the footpath piece on the tile in front whose edge toward the stall is level with the
 * stall floor: a flat path at the floor level, or a ramp whose low or high end meets it.
 */

/** Tile in front of a stall at (`x`, `y`) facing `dir`. */
export function stallFrontTile(x: number, y: number, dir: number): [number, number] {
  return [x + DIR_DX[dir & 3]!, y + DIR_DY[dir & 3]!];
}

/**
 * Verdict on one path piece on the front tile, for a stall whose floor is at `floor` and whose
 * window looks along `dir`: `RideResult.Ok` when guests can buy from it.
 */
export function judgeStallFrontPiece(
  base: number,
  flags: number,
  data: number,
  floor: number,
  dir: number,
): RideResult {
  if (flags & PathFlag.Queue) return RideResult.StallQueue;
  if (data & PATH_EXIT_MARK) return RideResult.StallGate;
  const edge = pathEdgeLevel(base, flags, (dir + 2) & 3);
  if (edge < 0) return RideResult.StallSlope;
  return edge === floor ? RideResult.Ok : RideResult.StallHeight;
}

/**
 * Accumulates piece verdicts on a front tile: any usable piece wins, otherwise the reason given
 * by the piece nearest the stall floor.
 */
class FrontVerdict {
  result: RideResult = RideResult.StallNoPath;
  /** Path element (sim) or path piece index (snapshot) that serves the stall, else -1. */
  piece = -1;
  private gap = Infinity;

  add(piece: number, base: number, flags: number, data: number, floor: number, dir: number): void {
    if (this.result === RideResult.Ok) return;
    const verdict = judgeStallFrontPiece(base, flags, data, floor, dir);
    const gap = verdict === RideResult.Ok ? -1 : Math.abs(base - floor);
    if (gap >= this.gap) return;
    this.gap = gap;
    this.result = verdict;
    this.piece = verdict === RideResult.Ok ? piece : -1;
  }
}

/** Front verdict and serving path element for a stall at (`x`, `y`) facing `dir` in the sim map. */
function frontAccess(
  map: TileMap,
  x: number,
  y: number,
  dir: number,
  floor: number,
): { result: RideResult; element: number } {
  const [fx, fy] = stallFrontTile(x, y, dir);
  if (!map.inBounds(fx, fy)) return { result: RideResult.OutOfBounds, element: -1 };
  const tile = map.index(fx, fy);
  if (!map.isWalkable(tile)) return { result: RideResult.StallNoPath, element: -1 };
  if (!map.canBuild(tile)) return { result: RideResult.NotOwned, element: -1 };
  const verdict = new FrontVerdict();
  let rank = 0;
  for (let e = map.firstElement(tile); e >= 0; e = map.nextElement(e)) {
    if (map.elType[e] !== ElementType.Path) continue;
    if (rank++ >= WALK_LAYERS) break;
    verdict.add(e, map.elBase[e]!, map.elFlags[e]!, map.elData[e]!, floor, dir);
  }
  return { result: verdict.result, element: verdict.piece };
}

function stallFloor(world: World, slot: number): number {
  const ride = world.rides.cols;
  const def = RIDE_CATALOG[ride.typeId[slot] as RideType];
  return rideBaseLevel(world.map, def, ride.rideX[slot]!, ride.rideY[slot]!, ride.dir[slot]!);
}

/** Why guests cannot buy from the stall in `slot` (`RideResult.Ok` when they can). */
export function stallSlotProblem(world: World, slot: number): RideResult {
  const ride = world.rides.cols;
  return frontAccess(
    world.map,
    ride.rideX[slot]!,
    ride.rideY[slot]!,
    ride.dir[slot]!,
    stallFloor(world, slot),
  ).result;
}

/** Why guests cannot buy from stall `rideId` (`RideResult.Ok` when they can). */
export function stallFrontProblem(world: World, rideId: number): RideResult {
  if (!world.rides.isAlive(rideId)) return RideResult.NoSuchRide;
  return stallSlotProblem(world, world.rides.idToSlot[rideId]!);
}

/**
 * Walk node guests stand on to buy from the stall in `slot`: the serving path piece's layer on
 * the front tile, or -1 when nothing serves it.
 */
export function stallServiceNode(world: World, slot: number): number {
  const ride = world.rides.cols;
  if (!ride.entrancePlaced[slot]) return -1;
  const map = world.map;
  const { element } = frontAccess(
    map,
    ride.rideX[slot]!,
    ride.rideY[slot]!,
    ride.dir[slot]!,
    stallFloor(world, slot),
  );
  if (element < 0) return -1;
  const [fx, fy] = stallFrontTile(ride.rideX[slot]!, ride.rideY[slot]!, ride.dir[slot]!);
  const tile = map.index(fx, fy);
  let rank = 0;
  for (let e = map.firstElement(tile); e >= 0 && e !== element; e = map.nextElement(e))
    if (map.elType[e] === ElementType.Path) rank++;
  return rank * map.width * map.height + tile;
}

/**
 * Re-reads the stall in `slot` from its stored facing: its access tile is always the tile in front
 * and it is reachable when that tile serves it. The stall's open or closed state is left alone.
 */
export function syncStallFront(world: World, slot: number): void {
  const ride = world.rides.cols;
  const [fx, fy] = stallFrontTile(ride.rideX[slot]!, ride.rideY[slot]!, ride.dir[slot]!);
  ride.entranceX[slot] = fx;
  ride.entranceY[slot] = fy;
  ride.entrancePlaced[slot] = stallSlotProblem(world, slot) === RideResult.Ok ? 1 : 0;
}

/**
 * Turns the stall in `slot` to face the adjacent tile (`x`, `y`) when that tile would serve it.
 * Returns the reason when it would not, leaving the stall as it was.
 */
export function faceStallToward(world: World, slot: number, x: number, y: number): RideResult {
  const ride = world.rides.cols;
  const dx = x - ride.rideX[slot]!;
  const dy = y - ride.rideY[slot]!;
  let dir = -1;
  for (let d = 0; d < 4; d++) if (DIR_DX[d] === dx && DIR_DY[d] === dy) dir = d;
  if (dir < 0) return RideResult.NotAdjacentToStation;
  const previous = ride.dir[slot]!;
  ride.dir[slot] = dir;
  const problem = stallSlotProblem(world, slot);
  if (problem !== RideResult.Ok) ride.dir[slot] = previous;
  syncStallFront(world, slot);
  return problem;
}

/**
 * Gives every stall in a loaded park the facing its stored service tile implies, then re-reads
 * its front. Parks saved before stalls kept a facing hold dir 0 and the tile guests used, or the
 * stall's own tile when it never had one; such a stall faces the first side (+x, +y, -x, -y) with
 * an ordinary footpath, which is where it was drawn facing, else +y. Current saves already keep
 * the service tile in front, so they load unchanged.
 */
export function normalizeStallFronts(world: World): void {
  const ride = world.rides.cols;
  const map = world.map;
  for (let slot = 0; slot < world.rides.count; slot++) {
    const category = RIDE_CATALOG[ride.typeId[slot] as RideType]?.category;
    if (category !== 'stall' && category !== 'facility') continue;
    const x = ride.rideX[slot]!;
    const y = ride.rideY[slot]!;
    let dir = -1;
    for (let d = 0; d < 4 && dir < 0; d++) {
      const [fx, fy] = stallFrontTile(x, y, d);
      if (ride.entranceX[slot] === fx && ride.entranceY[slot] === fy) dir = d;
    }
    for (let d = 0; d < 4 && dir < 0; d++) {
      const [fx, fy] = stallFrontTile(x, y, d);
      if (!map.inBounds(fx, fy)) continue;
      const tile = map.index(fx, fy);
      for (let e = map.firstElement(tile); e >= 0; e = map.nextElement(e))
        if (map.elType[e] === ElementType.Path && !(map.elFlags[e]! & PathFlag.Queue)) dir = d;
    }
    ride.dir[slot] = dir < 0 ? 1 : dir;
    syncStallFront(world, slot);
  }
}

/** Path pieces the snapshot publishes, in `MapData.pathElements` layout (x, y, base, flags, data, style). */
export interface StallFrontMap {
  width: number;
  height: number;
  pathElements?: Int32Array;
  pathCount?: number;
}

const PATH_STRIDE = 6;

/**
 * The same front verdict from the snapshot map, for previews: why a stall with its floor at
 * `floor` placed at (`x`, `y`) facing `dir` could not serve guests. `buildable` tells whether the
 * front tile is owned or has construction rights.
 */
export function stallFrontProblemInMap(
  map: StallFrontMap,
  x: number,
  y: number,
  dir: number,
  floor: number,
  buildable: (tile: number) => boolean,
): RideResult {
  const [fx, fy] = stallFrontTile(x, y, dir);
  if (fx < 0 || fy < 0 || fx >= map.width || fy >= map.height) return RideResult.OutOfBounds;
  const elements = map.pathElements;
  const count = Math.min(map.pathCount ?? 0, Math.floor((elements?.length ?? 0) / PATH_STRIDE));
  const verdict = new FrontVerdict();
  let found = false;
  let rank = 0;
  for (let index = 0; index < count; index++) {
    const o = index * PATH_STRIDE;
    if (elements![o] !== fx || elements![o + 1] !== fy) continue;
    found = true;
    if (rank++ >= WALK_LAYERS) break;
    verdict.add(index, elements![o + 2]!, elements![o + 3]!, elements![o + 4]!, floor, dir);
  }
  if (!found) return RideResult.StallNoPath;
  if (!buildable(fy * map.width + fx)) return RideResult.NotOwned;
  return verdict.result;
}

/**
 * Facing a stall placed at (`x`, `y`) takes by itself: `preferred` when that front would serve
 * guests, else the first of +x, +y, -x, -y that would, else `preferred`.
 */
export function autoStallFacing(
  map: StallFrontMap,
  x: number,
  y: number,
  floor: number,
  preferred: number,
  buildable: (tile: number) => boolean,
): number {
  const ok = (dir: number) =>
    stallFrontProblemInMap(map, x, y, dir, floor, buildable) === RideResult.Ok;
  if (ok(preferred & 3)) return preferred & 3;
  for (let dir = 0; dir < 4; dir++) if (ok(dir)) return dir;
  return preferred & 3;
}
