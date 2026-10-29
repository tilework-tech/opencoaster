import type { World } from '../core/world';
import { TILE_UNITS } from '../core/constants';
import {
  DIR_DX,
  DIR_DY,
  ElementType,
  PathFlag,
  isBoardingGate,
  isPathElementBroken,
} from '../map/tile-map';
import type { TileMap } from '../map/tile-map';
import { isReachable } from '../pathfinding';
import { GuestState } from './guest-store';

/** Seats along one open path edge; a rendered bench is wide enough for two guests. */
export const SEATS_PER_EDGE = 2;
/** Seat positions are measured from the tile centre toward the open edge, in world units. */
const SEAT_EDGE_OFFSET = 95;
/** Distance of each seat from the middle of the edge, along the edge. */
const SEAT_SPREAD = 31;
/** Seats per tile: two on each of the four edges. */
const SEATS_PER_TILE = 8;

/** Tiles per side of the blocks that the bench lookup groups benches into. */
const BLOCK_SHIFT = 3;

/** The seat a guest occupies, as `seat` column code `1 + edge * 2 + slot`; zero means none. */
export function seatCode(edge: number, slot: number): number {
  return 1 + edge * SEATS_PER_EDGE + slot;
}

export function seatEdge(code: number): number {
  return (code - 1) >> 1;
}

function seatSlot(code: number): number {
  return (code - 1) & 1;
}

/** World position of a seat on tile (`tileX`, `tileY`). */
export function seatPosition(
  tileX: number,
  tileY: number,
  code: number,
  out: { x: number; y: number },
): void {
  const edge = seatEdge(code);
  const along = seatSlot(code) === 0 ? -SEAT_SPREAD : SEAT_SPREAD;
  out.x =
    tileX * TILE_UNITS +
    TILE_UNITS / 2 +
    DIR_DX[edge]! * SEAT_EDGE_OFFSET +
    Math.abs(DIR_DY[edge]!) * along;
  out.y =
    tileY * TILE_UNITS +
    TILE_UNITS / 2 +
    DIR_DY[edge]! * SEAT_EDGE_OFFSET +
    Math.abs(DIR_DX[edge]!) * along;
}

/**
 * Open edges of the bench on `tile` that guests may sit at: bit `1 << edge`. A bench counts when
 * it is on a flat, ordinary path piece and is not vandalised; it is drawn on every edge of the
 * piece that no other path joins, so those edges are the seats.
 */
export function usableBenchEdges(map: TileMap, tile: number): number {
  const element = map.pathElement(tile, -1);
  if (element < 0) return 0;
  const flags = map.elFlags[element]!;
  if ((flags & PathFlag.Bench) === 0) return 0;
  if ((flags & (PathFlag.Sloped | PathFlag.Queue)) !== 0) return 0;
  if (isPathElementBroken(map, element) || isBoardingGate(map, element)) return 0;
  return ~map.pathEdgesOf(element) & 0xf;
}

function seatKey(tile: number, code: number): number {
  return tile * SEATS_PER_TILE + code - 1;
}

/** True when a live guest holds the seat. Stale records (a guest gone or risen) read as free. */
function seatTaken(world: World, tile: number, code: number): boolean {
  const key = seatKey(tile, code);
  const id = world.seatOwners.get(key);
  if (id === undefined) return false;
  const slot = world.guests.idToSlot[id] ?? -1;
  const live =
    slot >= 0 &&
    world.guests.slotToId[slot] === id &&
    world.guests.cols.seat[slot] === code &&
    world.guests.cols.state[slot] === GuestState.Sitting &&
    tileOfGuest(world, slot) === tile;
  if (!live) world.seatOwners.delete(key);
  return live;
}

function tileOfGuest(world: World, slot: number): number {
  const g = world.guests.cols;
  return world.map.index(g.x[slot]! >> 8, g.y[slot]! >> 8);
}

/** True when some guest sits (or is walking to sit) on the tile's bench. */
export function tileHasSeatedGuest(world: World, tile: number): boolean {
  for (let code = 1; code <= SEATS_PER_TILE; code++) if (seatTaken(world, tile, code)) return true;
  return false;
}

/** True when the tile has a usable bench with at least one free seat. */
export function benchHasFreeSeat(world: World, tile: number): boolean {
  const edges = usableBenchEdges(world.map, tile);
  if (edges === 0) return false;
  for (let edge = 0; edge < 4; edge++) {
    if ((edges & (1 << edge)) === 0) continue;
    for (let slot = 0; slot < SEATS_PER_EDGE; slot++)
      if (!seatTaken(world, tile, seatCode(edge, slot))) return true;
  }
  return false;
}

/**
 * Picks a free seat on the tile's bench and claims it for `guestId`: a random usable edge to begin
 * with, then the next ones in turn, and on the edge the free seat (the first when both are free,
 * chosen by the shared PRNG). Returns the seat code, or 0 when every usable seat is taken.
 */
export function claimSeat(world: World, tile: number, guestId: number): number {
  if (!benchHasFreeSeat(world, tile)) return 0;
  const edges = usableBenchEdges(world.map, tile);
  const start = world.rng.int(4);
  for (let i = 0; i < 4; i++) {
    const edge = (start + i) & 3;
    if ((edges & (1 << edge)) === 0) continue;
    const first = world.rng.int(SEATS_PER_EDGE);
    for (let k = 0; k < SEATS_PER_EDGE; k++) {
      const code = seatCode(edge, (first + k) % SEATS_PER_EDGE);
      if (seatTaken(world, tile, code)) continue;
      world.seatOwners.set(seatKey(tile, code), guestId);
      return code;
    }
  }
  return 0;
}

/** Frees the seat a guest holds, if any. */
export function releaseSeat(world: World, slot: number): void {
  const g = world.guests.cols;
  const code = g.seat[slot]!;
  if (code === 0) return;
  const key = seatKey(tileOfGuest(world, slot), code);
  if (world.seatOwners.get(key) === world.guests.slotToId[slot]) world.seatOwners.delete(key);
  g.seat[slot] = 0;
}

/**
 * Rebuilds the seat records from the guests, after a load. A seat claimed twice, or by a guest
 * not on a tile any more, is released: the extra guest simply stands.
 */
export function rebuildSeatOwners(world: World): void {
  world.seatOwners.clear();
  const g = world.guests.cols;
  for (let slot = 0; slot < world.guests.count; slot++) {
    const code = g.seat[slot]!;
    if (code === 0) continue;
    const key = seatKey(tileOfGuest(world, slot), code);
    if (g.state[slot] !== GuestState.Sitting || world.seatOwners.has(key)) {
      g.seat[slot] = 0;
      if (g.state[slot] === GuestState.Sitting) g.state[slot] = GuestState.Wandering;
      continue;
    }
    world.seatOwners.set(key, world.guests.slotToId[slot]!);
  }
}

interface BenchIndex {
  revision: number;
  blocksWide: number;
  /** Start of each block's run in `tiles`; one extra entry closes the last run. */
  starts: Int32Array;
  tiles: Int32Array;
}

const indexes = new WeakMap<TileMap, BenchIndex>();

/** Benches grouped into square blocks of tiles, rebuilt only when the map has changed. */
function benchIndex(map: TileMap): BenchIndex {
  let index = indexes.get(map);
  if (index && index.revision === map.revision) return index;
  const blocksWide = (map.width + (1 << BLOCK_SHIFT) - 1) >> BLOCK_SHIFT;
  const blocks = blocksWide * ((map.height + (1 << BLOCK_SHIFT) - 1) >> BLOCK_SHIFT);
  const counts = new Int32Array(blocks + 1);
  const found: number[] = [];
  for (let tile = 0; tile < map.width * map.height; tile++) {
    for (let e = map.firstElement(tile); e >= 0; e = map.elNext[e]!) {
      if (map.elType[e] !== ElementType.Path) continue;
      if ((map.elFlags[e]! & PathFlag.Bench) === 0) break;
      found.push(tile);
      counts[blockOf(map, tile, blocksWide) + 1]!++;
      break;
    }
  }
  for (let b = 0; b < blocks; b++) counts[b + 1]! += counts[b]!;
  const tiles = new Int32Array(found.length);
  const cursor = counts.slice(0, blocks);
  for (const tile of found) tiles[cursor[blockOf(map, tile, blocksWide)]!++] = tile;
  index = { revision: map.revision, blocksWide, starts: counts, tiles };
  indexes.set(map, index);
  return index;
}

function blockOf(map: TileMap, tile: number, blocksWide: number): number {
  return (
    (((tile / map.width) | 0) >> BLOCK_SHIFT) * blocksWide + ((tile % map.width) >> BLOCK_SHIFT)
  );
}

/**
 * Nearest tile within `radius` tiles (Chebyshev) of `tile` whose bench has a free seat and that
 * a guest standing on walk node `fromNode` can reach; -1 when there is none. Only blocks that overlap the search square are
 * visited, so the cost follows the benches nearby, not the benches in the park.
 */
export function nearestFreeBench(
  world: World,
  tile: number,
  radius: number,
  fromNode: number,
): number {
  const map = world.map;
  const index = benchIndex(map);
  const cx = tile % map.width;
  const cy = (tile / map.width) | 0;
  const bx0 = Math.max(0, cx - radius) >> BLOCK_SHIFT;
  const bx1 = Math.min(map.width - 1, cx + radius) >> BLOCK_SHIFT;
  const by0 = Math.max(0, cy - radius) >> BLOCK_SHIFT;
  const by1 = Math.min(map.height - 1, cy + radius) >> BLOCK_SHIFT;
  let best = -1;
  let bestDistance = radius + 1;
  for (let by = by0; by <= by1; by++) {
    for (let bx = bx0; bx <= bx1; bx++) {
      const block = by * index.blocksWide + bx;
      for (let i = index.starts[block]!; i < index.starts[block + 1]!; i++) {
        const candidate = index.tiles[i]!;
        const distance = Math.max(
          Math.abs((candidate % map.width) - cx),
          Math.abs(((candidate / map.width) | 0) - cy),
        );
        if (distance >= bestDistance) continue;
        if (!benchHasFreeSeat(world, candidate) || !isReachable(world, fromNode, candidate))
          continue;
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best;
}
