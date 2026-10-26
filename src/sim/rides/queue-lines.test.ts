import { describe, expect, it } from 'vitest';
import { Prng } from '../core/prng';
import { flatWorld, layPath, row } from '../integration/fixtures';
import {
  createRide,
  estimatedWaitTicks,
  placeRideEntranceExit,
  rideQueueCapacity,
  setRideQueueLimit,
} from './ride-operations';
import { RideType } from './ride-types';
import { refreshQueueIndex } from './queue-lines';
import { DEFAULT_GUEST_OPTS, DIR_E, DIR_NONE, isReachable, nextDirection } from '../pathfinding';
import type { World } from '../core/world';

/** Ride covering (10..12, 2..4) entered from (11, 5) along a queue running west to (9, 5), exit at (13, 4). */
function parkWithQueue(): { w: World; slot: number } {
  const w = flatWorld();
  layPath(w, row(5, 2, 8));
  layPath(w, row(5, 9, 11), true);
  layPath(w, [[13, 4]]);
  const id = createRide(w, RideType.MerryGoRound, 11, 3);
  placeRideEntranceExit(w, id, { x: 11, y: 5 }, { x: 13, y: 4 });
  refreshQueueIndex(w);
  return { w, slot: w.rides.idToSlot[id] };
}

const T = (w: World, x: number, y: number): number => w.map.index(x, y);

describe('queue lines', () => {
  it('belong to the ride whose entrance they connect to, with an open end on the main path', () => {
    const { w, slot } = parkWithQueue();
    const q = w.queues;
    expect(q.owner[T(w, 11, 5)]).toBe(slot);
    expect(q.owner[T(w, 9, 5)]).toBe(slot);
    expect(q.dist[T(w, 9, 5)]).toBe(2);
    expect(q.tiles[slot]).toBe(2);
    expect(q.openTile[slot]).toBe(T(w, 9, 5));
    expect(q.joinTile[slot]).toBe(T(w, 8, 5));
  });

  it('are not part of the walking network', () => {
    const { w } = parkWithQueue();
    expect(w.map.edgeMask(T(w, 8, 5)) & (1 << DIR_E)).toBe(0);
    expect(w.map.edgeMask(T(w, 10, 5))).toBe(0);
    expect(isReachable(w, T(w, 2, 5), T(w, 11, 5))).toBe(false);
    expect(isReachable(w, T(w, 2, 5), T(w, 8, 5))).toBe(true);
    expect(nextDirection(w, T(w, 8, 5), T(w, 11, 5), new Prng(1))).toBe(DIR_NONE);
  });

  it('are never entered by a wandering walker', () => {
    const { w } = parkWithQueue();
    const rng = new Prng(7);
    let tile = T(w, 2, 5);
    let from = DIR_NONE;
    for (let step = 0; step < 2000; step++) {
      const dir = nextDirection(w, tile, -1, rng, { ...DEFAULT_GUEST_OPTS, fromDir: from });
      if (dir === DIR_NONE) break;
      tile = w.map.neighbor(tile, dir);
      from = dir;
      expect(w.map.isQueue(tile)).toBe(false);
    }
  });

  it('join other paths only at the open end, never along their length', () => {
    const w = flatWorld();
    layPath(w, row(6, 8, 13));
    layPath(w, row(5, 9, 13), true);
    layPath(w, [[15, 4]]);
    const id = createRide(w, RideType.MerryGoRound, 13, 3);
    placeRideEntranceExit(w, id, { x: 13, y: 5 }, { x: 15, y: 4 });
    refreshQueueIndex(w);
    const slot = w.rides.idToSlot[id];
    for (let x = 10; x <= 13; x++) expect(w.map.pathEdges(T(w, x, 5)) & (1 << 1)).toBe(0);
    expect(w.map.pathEdges(T(w, 9, 5)) & (1 << 1)).not.toBe(0);
    expect(w.queues.openTile[slot]).toBe(T(w, 9, 5));
    expect(w.queues.joinTile[slot]).toBe(T(w, 9, 6));
  });

  it('never join the ride exit', () => {
    const w = flatWorld();
    layPath(w, [[10, 3]], true);
    layPath(w, [[10, 4]], true);
    layPath(w, [[10, 5]]);
    const id = createRide(w, RideType.MerryGoRound, 12, 4);
    placeRideEntranceExit(w, id, { x: 10, y: 3 }, { x: 10, y: 5 });
    refreshQueueIndex(w);
    expect(w.map.pathEdges(T(w, 10, 4)) & (1 << 1)).toBe(0);
    expect(w.map.pathEdges(T(w, 10, 5)) & (1 << 3)).toBe(0);
  });

  it('extend to a queue tile built beside the open end, but not beside the middle of the line', () => {
    const { w, slot } = parkWithQueue();
    layPath(w, [[10, 6]], true);
    refreshQueueIndex(w);
    expect(w.queues.owner[T(w, 10, 6)]).toBe(-1);
    layPath(w, [[9, 6]], true);
    refreshQueueIndex(w);
    expect(w.queues.owner[T(w, 9, 6)]).toBe(slot);
    expect(w.queues.tiles[slot]).toBe(3);
  });

  it('holds one guest per queue tile plus the loading area, and obeys the queue limit', () => {
    const { w, slot } = parkWithQueue();
    const natural = rideQueueCapacity(w, slot);
    expect(natural).toBe(2 + w.rides.cols.capacity[slot]);
    expect(setRideQueueLimit(w, w.rides.slotToId[slot], 3)).toBe(true);
    expect(rideQueueCapacity(w, slot)).toBe(3);
    expect(setRideQueueLimit(w, w.rides.slotToId[slot], natural + 10)).toBe(true);
    expect(rideQueueCapacity(w, slot)).toBe(natural);
    expect(setRideQueueLimit(w, w.rides.slotToId[slot], 0)).toBe(true);
    expect(rideQueueCapacity(w, slot)).toBe(natural);
  });

  it('estimates the wait from the whole line, not only the guests at the head', () => {
    const { w, slot } = parkWithQueue();
    expect(estimatedWaitTicks(w, slot)).toBe(0);
    w.rideLines.queued[slot] = w.rides.cols.capacity[slot] * 2;
    const trip =
      w.rides.cols.loadTicks[slot] + w.rides.cols.runTicks[slot] + w.rides.cols.unloadTicks[slot];
    expect(estimatedWaitTicks(w, slot)).toBe(trip * 2);
  });

  it('counts queue tiles that belong to no ride', () => {
    const w = flatWorld();
    layPath(w, row(5, 2, 4));
    layPath(w, row(5, 5, 7), true);
    refreshQueueIndex(w);
    expect(w.queues.orphanTiles).toBe(3);
  });
});
