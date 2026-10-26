import type { World } from '../core/world';
import { PATH_ENTRANCE_MARK, PATH_EXIT_MARK } from '../map/tile-map';
import { queueOpening, recomputePathEdges, trimEntranceLinks } from '../map/paths';
import { RIDE_CATALOG } from './ride-types';
import type { RideType } from './ride-types';
import { DIR_DX, DIR_DY } from '../pathfinding/directions';
import { GuestState } from '../guests/guest-store';

/**
 * Which queue tiles belong to which ride and how far each is from the ride entrance. Derived from
 * the map and the rides' entrances (never saved or hashed) and rebuilt when either changes.
 */
export interface QueueIndex {
  /** Ride slot owning each queue tile, or -1. */
  owner: Int16Array;
  /** Steps from the owning ride's entrance along the queue; 0 at the entrance. */
  dist: Uint16Array;
  /** Per ride slot: the queue tile at the open end, or -1 when it has no open end. */
  openTile: Int32Array;
  /** Per ride slot: the ordinary path tile the open end joins, or -1. */
  joinTile: Int32Array;
  /** Per ride slot: queue tiles behind the entrance. */
  tiles: Uint16Array;
  /** Per ride slot: 1 when the entrance is a queue tile (0 for rides entered straight from a path). */
  hasQueue: Uint8Array;
  /** Tile occupancy by queuing guests: valid for `occStamp` ticks only. */
  occupied: Uint32Array;
  occStamp: number;
  /** Boarding marks currently written into the map: `tile * 2` for an entrance, `+ 1` for an exit. */
  marks: Int32Array;
  marksScratch: Int32Array;
  markCount: number;
  /** Queue tiles that belong to no ride. */
  orphanTiles: number;
  ready: boolean;
  pathVersion: number;
  scratch: Int32Array;
}

export function createQueueIndex(tiles: number, rideCapacity: number): QueueIndex {
  return {
    owner: new Int16Array(tiles).fill(-1),
    dist: new Uint16Array(tiles),
    openTile: new Int32Array(rideCapacity).fill(-1),
    joinTile: new Int32Array(rideCapacity).fill(-1),
    tiles: new Uint16Array(rideCapacity),
    hasQueue: new Uint8Array(rideCapacity),
    occupied: new Uint32Array(tiles),
    occStamp: 1,
    marks: new Int32Array(rideCapacity * 2),
    marksScratch: new Int32Array(rideCapacity * 2),
    markCount: 0,
    orphanTiles: 0,
    ready: false,
    pathVersion: -1,
    scratch: new Int32Array(tiles),
  };
}

function usesQueue(world: World, slot: number): boolean {
  const category = RIDE_CATALOG[world.rides.cols.typeId[slot] as RideType]?.category;
  return category !== 'stall' && category !== 'facility';
}

function markBit(world: World, tile: number, bit: number, on: boolean): void {
  const e = world.map.pathElement(tile, -1);
  if (e < 0) return;
  if (on) world.map.elData[e] |= bit;
  else world.map.elData[e] &= ~bit;
}

/**
 * Writes each ride's entrance and exit onto the path tiles that hold them, so queue pieces know
 * where a line starts and which tile they must never join. Returns true when anything changed.
 */
function syncBoardingMarks(world: World): boolean {
  const q = world.queues;
  const map = world.map;
  const ride = world.rides.cols;
  const next = q.marksScratch;
  let n = 0;
  for (let slot = 0; slot < world.rides.count; slot++) {
    if (!usesQueue(world, slot)) continue;
    if (ride.entrancePlaced[slot] && map.inBounds(ride.entranceX[slot], ride.entranceY[slot])) {
      next[n++] = map.index(ride.entranceX[slot], ride.entranceY[slot]) * 2;
    }
    if (ride.exitPlaced[slot] && map.inBounds(ride.exitX[slot], ride.exitY[slot])) {
      next[n++] = map.index(ride.exitX[slot], ride.exitY[slot]) * 2 + 1;
    }
  }
  let same = q.ready && n === q.markCount;
  for (let k = 0; same && k < n; k++) same = next[k] === q.marks[k];
  if (same) return false;

  if (!q.ready) {
    for (let i = 0; i < map.width * map.height; i++) {
      for (let e = map.firstElement(i); e >= 0; e = map.nextElement(e)) {
        map.elData[e] &= ~(PATH_ENTRANCE_MARK | PATH_EXIT_MARK);
      }
    }
  } else {
    for (let k = 0; k < q.markCount; k++) {
      markBit(world, q.marks[k] >> 1, q.marks[k] & 1 ? PATH_EXIT_MARK : PATH_ENTRANCE_MARK, false);
    }
  }
  for (let k = 0; k < n; k++) {
    markBit(world, next[k] >> 1, next[k] & 1 ? PATH_EXIT_MARK : PATH_ENTRANCE_MARK, true);
  }
  for (let k = 0; k < n; k++) {
    if (next[k] & 1) continue;
    const tile = next[k] >> 1;
    const e = map.pathElement(tile, -1);
    if (e >= 0 && map.isQueue(tile)) trimEntranceLinks(map, tile, e);
  }
  for (let k = 0; k < n; k++) recomputePathEdges(map, next[k] >> 1);
  for (let k = 0; k < q.markCount; k++) recomputePathEdges(map, q.marks[k] >> 1);
  q.marks.set(next.subarray(0, n));
  q.markCount = n;
  q.ready = true;
  return true;
}

function rebuild(world: World): void {
  const q = world.queues;
  const map = world.map;
  const ride = world.rides.cols;
  q.owner.fill(-1);
  q.openTile.fill(-1, 0, world.rides.count);
  q.joinTile.fill(-1, 0, world.rides.count);
  q.tiles.fill(0, 0, world.rides.count);
  q.hasQueue.fill(0, 0, world.rides.count);
  const frontier = q.scratch;
  for (let slot = 0; slot < world.rides.count; slot++) {
    if (!usesQueue(world, slot) || !ride.entrancePlaced[slot]) continue;
    if (!map.inBounds(ride.entranceX[slot], ride.entranceY[slot])) continue;
    const entrance = map.index(ride.entranceX[slot], ride.entranceY[slot]);
    if (!map.isQueue(entrance)) {
      q.joinTile[slot] = map.isWalkable(entrance) ? entrance : -1;
      continue;
    }
    if (q.owner[entrance] >= 0) continue;
    q.hasQueue[slot] = 1;
    let head = 0;
    let tail = 0;
    frontier[tail++] = entrance;
    q.owner[entrance] = slot;
    q.dist[entrance] = 0;
    while (head < tail) {
      const tile = frontier[head++];
      if (q.openTile[slot] < 0) {
        const opening = queueOpening(map, tile, map.pathElement(tile, -1));
        if (opening >= 0) {
          q.openTile[slot] = tile;
          q.joinTile[slot] = map.neighbor(tile, opening);
        }
      }
      const edges = map.pathEdges(tile);
      for (let d = 0; d < 4; d++) {
        if (!(edges & (1 << d))) continue;
        const next = map.neighbor(tile, d);
        if (next < 0 || q.owner[next] >= 0 || !map.isQueue(next)) continue;
        q.owner[next] = slot;
        q.dist[next] = q.dist[tile] + 1;
        frontier[tail++] = next;
      }
    }
    q.tiles[slot] = tail - 1;
  }
  let orphans = 0;
  for (let i = 0; i < q.owner.length; i++) if (q.owner[i] < 0 && map.isQueue(i)) orphans++;
  q.orphanTiles = orphans;
  q.pathVersion = map.pathVersion;
}

/** Brings the boarding marks and queue lines up to date with the map and the rides. */
export function refreshQueueIndex(world: World): void {
  const q = world.queues;
  const changed = syncBoardingMarks(world);
  if (changed || q.pathVersion !== world.map.pathVersion) rebuild(world);
}

/** Direction (0..3) from tile `from` to the adjacent tile `to`. */
export function directionBetween(world: World, from: number, to: number): number {
  const w = world.map.width;
  const dx = (to % w) - (from % w);
  const dy = ((to / w) | 0) - ((from / w) | 0);
  for (let d = 0; d < 4; d++) if (DIR_DX[d] === dx && DIR_DY[d] === dy) return d;
  return -1;
}

/** Tile a queuing guest at position (x, y) is standing on or walking toward. */
function claimedTile(world: World, slot: number): number {
  const g = world.guests.cols;
  const map = world.map;
  const tile = map.index(g.x[slot] >> 8, g.y[slot] >> 8);
  const heading = g.heading[slot];
  if (heading > 3) return tile;
  const horizontal = heading === 0 || heading === 2;
  const offset = (horizontal ? g.x[slot] : g.y[slot]) & 255;
  if (offset === 128) return tile;
  const forward = heading <= 1 ? offset > 128 : offset < 128;
  return forward ? map.neighbor(tile, heading) : tile;
}

/** Marks every tile a line-bound queuing guest occupies or is walking into. */
export function markQueueOccupancy(world: World): void {
  const q = world.queues;
  q.occStamp++;
  const g = world.guests.cols;
  for (let slot = 0; slot < world.guests.count; slot++) {
    if (g.state[slot] !== GuestState.Queuing || g.targetRide[slot] < 0) continue;
    const here = world.map.index(g.x[slot] >> 8, g.y[slot] >> 8);
    q.occupied[here] = q.occStamp;
    const ahead = claimedTile(world, slot);
    if (ahead >= 0) q.occupied[ahead] = q.occStamp;
  }
}

export function isQueueTileOccupied(world: World, tile: number): boolean {
  return world.queues.occupied[tile] === world.queues.occStamp;
}

export function claimQueueTile(world: World, tile: number): void {
  world.queues.occupied[tile] = world.queues.occStamp;
}
