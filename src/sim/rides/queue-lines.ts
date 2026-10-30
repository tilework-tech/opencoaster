import type { World } from '../core/world';
import { syncAllStallFronts } from './stall-front';
import {
  boardingFront,
  PATH_BOARDING_MARKS,
  PATH_ENTRANCE_MARK,
  PATH_EXIT_MARK,
  PATH_FRONT_DIR,
  PATH_FRONT_KNOWN,
} from '../map/tile-map';
import { queueOpening, recomputePathEdges, trimEntranceLinks } from '../map/paths';
import { RIDE_CATALOG } from './ride-types';
import { inferBoardingFronts } from './boarding-front';
import type { RideType } from './ride-types';
import { DIR_DX, DIR_DY } from '../pathfinding/directions';
import { GuestState } from '../guests/guest-store';
import { TILE_UNITS } from '../core/constants';

const TILE_CENTRE = TILE_UNITS >> 1;

/** Distance between guests standing in a line: four to a queue tile. */
export const QUEUE_SPACING = TILE_UNITS >> 2;

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
  /** Direction toward the ride entrance from each tile of a line, or -1. */
  down: Int8Array;
  /**
   * Direction toward the open end from each tile on the walked chain, or -1. The open tile points at
   * the path tile it joins.
   */
  up: Int8Array;
  /** Per ride slot: line coordinate of the last guest in the line, or -1 when it is empty. */
  tail: Int32Array;
  /** Per guest slot, valid for the tick: id of the guest the entry describes (-1 when not in a line). */
  lineGuest: Int32Array;
  /** Per guest slot: line coordinate of the guest directly ahead, or -1 for the head of the line. */
  lineAhead: Int32Array;
  /** Per guest slot: position in its line, 0 at the front; large unless every guest ahead is waiting to board. */
  lineRank: Int32Array;
  /** Scratch for ordering a line: `coordinate * 2^20 + guest slot`. */
  lineKeys: Float64Array;
  lineCounts: Int32Array;
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
    down: new Int8Array(tiles).fill(-1),
    up: new Int8Array(tiles).fill(-1),
    tail: new Int32Array(rideCapacity).fill(-1),
    lineGuest: new Int32Array(0),
    lineAhead: new Int32Array(0),
    lineRank: new Int32Array(0),
    lineKeys: new Float64Array(0),
    lineCounts: new Int32Array(rideCapacity + 1),
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

function writeMark(world: World, key: number, on: boolean): void {
  const e = world.map.pathElement(key >> 1, -1);
  if (e < 0) return;
  const data = world.map.elData;
  data[e] &= ~PATH_BOARDING_MARKS;
  if (!on) data[e] &= ~(PATH_FRONT_DIR | PATH_FRONT_KNOWN);
  if (on) data[e] |= key & 1 ? PATH_EXIT_MARK : PATH_ENTRANCE_MARK;
}

/** Gives a ride's entrance and exit pieces a front edge when they have none, facing as the connections do. */
function ensureFronts(world: World, slot: number): void {
  const ride = world.rides.cols;
  const map = world.map;
  const missing = (x: number, y: number): boolean => {
    if (!map.inBounds(x, y)) return false;
    const e = map.pathElement(map.index(x, y), -1);
    return e >= 0 && !(map.elData[e] & PATH_FRONT_KNOWN);
  };
  if (
    (ride.entrancePlaced[slot] && missing(ride.entranceX[slot], ride.entranceY[slot])) ||
    (ride.exitPlaced[slot] && missing(ride.exitX[slot], ride.exitY[slot]))
  )
    inferBoardingFronts(world, slot);
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
        map.elData[e] &= ~PATH_BOARDING_MARKS;
      }
    }
  } else {
    for (let k = 0; k < q.markCount; k++) writeMark(world, q.marks[k], false);
  }
  for (let k = 0; k < n; k++) writeMark(world, next[k], true);
  for (let slot = 0; slot < world.rides.count; slot++)
    if (usesQueue(world, slot)) ensureFronts(world, slot);
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

/** Path tile a guest walks to for an entrance with no queue line: the one in front of it, or the entrance itself when it has no front. */
function entranceApproach(map: World['map'], entrance: number): number {
  const e = map.pathElement(entrance, -1);
  if (e < 0) return -1;
  const front = boardingFront(map, e);
  if (front < 0) return entrance;
  const n = map.neighbor(entrance, front);
  return n >= 0 && map.adjoiningPath(entrance, e, front) >= 0 ? n : -1;
}

function rebuild(world: World): void {
  const q = world.queues;
  const map = world.map;
  const ride = world.rides.cols;
  q.owner.fill(-1);
  q.down.fill(-1);
  q.up.fill(-1);
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
      q.joinTile[slot] = entranceApproach(map, entrance);
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
        q.down[next] = (d + 2) & 3;
        frontier[tail++] = next;
      }
    }
    q.tiles[slot] = tail - 1;
    let chain = q.openTile[slot];
    if (chain >= 0) q.up[chain] = directionBetween(world, chain, q.joinTile[slot]);
    while (chain >= 0 && q.down[chain] >= 0) {
      const below = map.neighbor(chain, q.down[chain]);
      q.up[below] = (q.down[chain] + 2) & 3;
      chain = below;
    }
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
  if (changed || q.pathVersion !== world.map.pathVersion) {
    rebuild(world);
    syncAllStallFronts(world);
  }
}

/** Direction (0..3) from tile `from` to the adjacent tile `to`. */
export function directionBetween(world: World, from: number, to: number): number {
  const w = world.map.width;
  const dx = (to % w) - (from % w);
  const dy = ((to / w) | 0) - ((from / w) | 0);
  for (let d = 0; d < 4; d++) if (DIR_DX[d] === dx && DIR_DY[d] === dy) return d;
  return -1;
}

/**
 * Position of (x, y) along ride `ride`'s line, in world units from the centre of the entrance tile.
 * The line is the polyline through the centres of the queue tiles from the open end to the
 * entrance, continued one tile past the open end through the path tile it joins. Returns -1 off
 * the line.
 */
export function queueLineCoord(world: World, ride: number, x: number, y: number): number {
  const q = world.queues;
  const tile = world.map.index(x >> 8, y >> 8);
  const ox = (x & (TILE_UNITS - 1)) - TILE_CENTRE;
  const oy = (y & (TILE_UNITS - 1)) - TILE_CENTRE;
  if (q.owner[tile] === ride) {
    const base = q.dist[tile] * TILE_UNITS;
    const up = q.up[tile];
    const awayFromEntrance = up < 0 ? 0 : ox * DIR_DX[up] + oy * DIR_DY[up];
    if (awayFromEntrance > 0) return base + awayFromEntrance;
    const down = q.down[tile];
    const towardEntrance = down < 0 ? 0 : ox * DIR_DX[down] + oy * DIR_DY[down];
    return base - Math.max(0, towardEntrance);
  }
  const open = q.openTile[ride];
  if (open >= 0 && tile === q.joinTile[ride]) {
    const up = q.up[open];
    return (q.dist[open] + 1) * TILE_UNITS + ox * DIR_DX[up] + oy * DIR_DY[up];
  }
  return -1;
}

/**
 * Moves a guest at line coordinate `from` (standing on `tile`) down the line to `to <= from`.
 * Writes the new position through `out` and returns the heading of the move.
 */
export function queueLinePoint(
  world: World,
  ride: number,
  tile: number,
  to: number,
  out: { x: number; y: number },
): number {
  const q = world.queues;
  const map = world.map;
  let dist: number;
  let up: number;
  let down: number;
  if (q.owner[tile] === ride) {
    dist = q.dist[tile];
    up = q.up[tile];
    down = q.down[tile];
  } else {
    const open = q.openTile[ride];
    dist = q.dist[open] + 1;
    up = q.up[open];
    down = (up + 2) & 3;
  }
  const cx = (tile % map.width) * TILE_UNITS + TILE_CENTRE;
  const cy = Math.floor(tile / map.width) * TILE_UNITS + TILE_CENTRE;
  const rel = to - dist * TILE_UNITS;
  if (rel > 0 && up >= 0) {
    out.x = cx + DIR_DX[up] * rel;
    out.y = cy + DIR_DY[up] * rel;
    return (up + 2) & 3;
  }
  const d = down >= 0 ? down : (up + 2) & 3;
  out.x = cx - DIR_DX[d] * rel;
  out.y = cy - DIR_DY[d] * rel;
  return d;
}

/** Heading that walks a guest off the line's centre path back to the nearest tile centre or outward. */
export function queueSegmentHeading(world: World, x: number, y: number): number {
  const q = world.queues;
  const tile = world.map.index(x >> 8, y >> 8);
  const ox = (x & (TILE_UNITS - 1)) - TILE_CENTRE;
  const oy = (y & (TILE_UNITS - 1)) - TILE_CENTRE;
  const up = q.up[tile];
  if (up >= 0 && ox * DIR_DX[up] + oy * DIR_DY[up] > 0) return up;
  const down = q.down[tile];
  return down >= 0 ? (down + 2) & 3 : -1;
}

function ensureLineCapacity(q: QueueIndex, guests: number): void {
  if (q.lineGuest.length >= guests) return;
  const size = guests + (guests >> 1) + 16;
  q.lineGuest = new Int32Array(size);
  q.lineAhead = new Int32Array(size);
  q.lineRank = new Int32Array(size);
  q.lineKeys = new Float64Array(size);
}

/**
 * Orders every line's guests (queuing inbound plus waiting at the head) by their position along it:
 * records for each the coordinate of the guest ahead and its rank, and for each ride the last
 * guest's coordinate.
 */
export function updateQueueLines(world: World): void {
  const q = world.queues;
  const g = world.guests.cols;
  const rides = world.rides.count;
  ensureLineCapacity(q, world.guests.count);
  q.tail.fill(-1, 0, rides);
  q.lineCounts.fill(0, 0, rides + 1);
  const keys = q.lineKeys;
  q.lineGuest.fill(-1, 0, world.guests.count);
  let n = 0;
  for (let slot = 0; slot < world.guests.count; slot++) {
    const state = g.state[slot];
    if (state !== GuestState.Queuing && state !== GuestState.Waiting) continue;
    const id = g.targetRide[slot];
    if (id < 0) continue;
    const ride = world.rides.idToSlot[id];
    if (world.rides.slotToId[ride] !== id || !q.hasQueue[ride]) continue;
    const s = queueLineCoord(world, ride, g.x[slot], g.y[slot]);
    if (s < 0) continue;
    keys[n++] = (ride * 0x2000000 + s) * 0x100000 + slot;
  }
  // Insertion sort: lines are nearly ordered from one tick to the next.
  for (let i = 1; i < n; i++) {
    const key = keys[i];
    let j = i - 1;
    while (j >= 0 && keys[j] > key) {
      keys[j + 1] = keys[j];
      j--;
    }
    keys[j + 1] = key;
  }
  let previousRide = -1;
  let rank = 0;
  let aheadS = -1;
  let aheadReady = true;
  for (let i = 0; i < n; i++) {
    const key = keys[i];
    const slot = key % 0x100000;
    const rest = (key - slot) / 0x100000;
    const s = rest % 0x2000000;
    const ride = (rest - s) / 0x2000000;
    if (ride !== previousRide) {
      previousRide = ride;
      rank = 0;
      aheadS = -1;
      aheadReady = true;
    }
    q.lineGuest[slot] = world.guests.slotToId[slot];
    q.lineAhead[slot] = aheadS;
    q.lineRank[slot] = aheadReady ? rank : 0x7fffffff;
    rank++;
    aheadReady = aheadReady && g.state[slot] === GuestState.Waiting;
    q.tail[ride] = s;
    aheadS = s;
  }
}

/** True when a guest joining at the open end would stand closer than the spacing to the last one. */
export function queueEntryBlocked(world: World, ride: number): boolean {
  const q = world.queues;
  const tail = q.tail[ride];
  const open = q.openTile[ride];
  return tail >= 0 && open >= 0 && (q.dist[open] + 1) * TILE_UNITS - tail < QUEUE_SPACING;
}

/** Records a guest that just joined at the open end as the last in its line. */
export function noteQueueJoin(world: World, ride: number, slot: number, s: number): void {
  const q = world.queues;
  if (slot < q.lineGuest.length) {
    q.lineGuest[slot] = world.guests.slotToId[slot];
    q.lineAhead[slot] = q.tail[ride];
    q.lineRank[slot] = 0x7fffffff;
  }
  q.tail[ride] = s;
}
