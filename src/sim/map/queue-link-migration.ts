import type { World } from '../core/world';
import { PATH_QUEUE_LINKS } from './tile-map';
import { adjoiningElement, linkQueuePieces, recomputePathEdges } from './paths';

/** Neighbouring queue tiles of `tile` that are not yet part of a chain, in direction order. */
function freeQueueNeighbours(world: World, tile: number, claimed: Uint8Array): number[] {
  const map = world.map;
  const out: number[] = [];
  const e = map.pathElement(tile, -1);
  for (let d = 0; d < 4; d++) {
    const n = map.neighbor(tile, d);
    if (n < 0 || claimed[n]) continue;
    const f = adjoiningElement(map, tile, e, d);
    if (f >= 0 && map.isQueue(n)) out.push(d);
  }
  return out;
}

/**
 * Walks one chain from `start`, linking each tile to the next. It always takes the unvisited
 * neighbour with the fewest unvisited neighbours of its own (so it does not strand tiles behind
 * it), preferring to go straight on, then the lowest direction.
 */
function walkChain(world: World, start: number, claimed: Uint8Array): void {
  const map = world.map;
  let tile = start;
  let heading = -1;
  claimed[tile] = 1;
  for (;;) {
    let best = -1;
    let bestOnward = Infinity;
    for (const d of freeQueueNeighbours(world, tile, claimed)) {
      const onward = freeQueueNeighbours(world, map.neighbor(tile, d), claimed).length;
      if (onward < bestOnward || (onward === bestOnward && d === heading)) {
        best = d;
        bestOnward = onward;
      }
    }
    if (best < 0) return;
    const e = map.pathElement(tile, -1);
    linkQueuePieces(map, tile, e, best);
    tile = map.neighbor(tile, best);
    claimed[tile] = 1;
    heading = best;
  }
}

/**
 * Gives every queue tile of a world saved before queue links existed at most two links. Each ride
 * entrance on a queue tile starts one chain that runs along its queue neighbours; queue tiles no
 * chain reaches are chained into lines of their own, starting from the lowest-numbered tile with
 * the fewest neighbours. The result depends only on the map, so it is deterministic.
 */
export function migrateQueueLinks(world: World): void {
  const map = world.map;
  const tiles = map.width * map.height;
  for (let i = 0; i < tiles; i++) {
    for (let e = map.firstElement(i); e >= 0; e = map.nextElement(e))
      map.elData[e] &= ~PATH_QUEUE_LINKS;
  }
  const claimed = new Uint8Array(tiles);
  const rides = world.rides.cols;
  for (let slot = 0; slot < world.rides.count; slot++) {
    if (!rides.entrancePlaced[slot] || !map.inBounds(rides.entranceX[slot], rides.entranceY[slot]))
      continue;
    const entrance = map.index(rides.entranceX[slot], rides.entranceY[slot]);
    if (map.isQueue(entrance) && !claimed[entrance]) walkChain(world, entrance, claimed);
  }
  const remaining: number[] = [];
  for (let i = 0; i < tiles; i++) if (!claimed[i] && map.isQueue(i)) remaining.push(i);
  const degree = (i: number): number => freeQueueNeighbours(world, i, claimed).length;
  for (;;) {
    let start = -1;
    for (const i of remaining) {
      if (claimed[i]) continue;
      if (start < 0 || degree(i) < degree(start)) start = i;
    }
    if (start < 0) break;
    walkChain(world, start, claimed);
  }
  for (let i = 0; i < tiles; i++) if (map.isQueue(i)) recomputePathEdges(map, i);
}
