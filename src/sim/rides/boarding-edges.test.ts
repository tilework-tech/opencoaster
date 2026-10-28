import { describe, expect, it } from 'vitest';
import { Prng } from '../core/prng';
import { flatWorld, guestAt, layPath, openRide, row } from '../integration/fixtures';
import { createRide, placeRideEntranceExit } from './ride-operations';
import { rideQueueSystem } from './queue-system';
import { rideSystem } from './ride-system';
import { guestSystem } from '../guests/guest-system';
import { RideType } from './ride-types';
import { refreshQueueIndex } from './queue-lines';
import {
  DEFAULT_GUEST_OPTS,
  DIR_E,
  DIR_N,
  DIR_NONE,
  DIR_S,
  DIR_W,
  isReachable,
  nextDirection,
} from '../pathfinding';
import type { World } from '../core/world';

const T = (w: World, x: number, y: number): number => w.map.index(x, y);
const bit = (d: number): number => 1 << d;

/**
 * Merry-go-round covering (10..12, 2..4). Its exit hut is (13, 3) on the east side, so its front is
 * (14, 3). Paths run north-south along x = 13 on both sides of the hut and along x = 14 in front.
 */
function parkWithExit(): { w: World; exit: number } {
  const w = flatWorld();
  layPath(w, [
    [13, 1],
    [13, 2],
    [13, 4],
    [13, 5],
  ]);
  layPath(w, [[13, 3]]);
  layPath(w, [
    [14, 1],
    [14, 2],
    [14, 3],
    [14, 4],
    [14, 5],
  ]);
  layPath(w, row(6, 11, 14));
  const id = createRide(w, RideType.MerryGoRound, 11, 3);
  placeRideEntranceExit(w, id, { x: 11, y: 5 }, { x: 13, y: 3 });
  refreshQueueIndex(w);
  return { w, exit: T(w, 13, 3) };
}

describe('ride exit', () => {
  it('connects only to the path on its front edge', () => {
    const { w, exit } = parkWithExit();
    expect(w.map.pathEdges(exit)).toBe(bit(DIR_E));
    expect(w.map.pathEdges(T(w, 13, 2)) & bit(DIR_S)).toBe(0);
    expect(w.map.pathEdges(T(w, 13, 4)) & bit(DIR_N)).toBe(0);
    expect(w.map.pathEdges(T(w, 14, 3)) & bit(DIR_W)).not.toBe(0);
  });

  it('lets exiting guests leave only through the front edge', () => {
    const { w, exit } = parkWithExit();
    expect(w.map.edgeMask(exit)).toBe(bit(DIR_E));
    expect(nextDirection(w, exit, -1, new Prng(3))).toBe(DIR_E);
    expect(nextDirection(w, exit, T(w, 13, 5), new Prng(3))).toBe(DIR_E);
  });

  it('is never routed through by other guests', () => {
    const { w, exit } = parkWithExit();
    expect(isReachable(w, T(w, 13, 1), exit)).toBe(false);
    expect(isReachable(w, T(w, 14, 5), exit)).toBe(false);
    expect(nextDirection(w, T(w, 13, 2), exit, new Prng(1))).not.toBe(DIR_S);
    expect(w.map.edgeMask(T(w, 14, 3)) & bit(DIR_W)).toBe(0);
    expect(w.map.edgeMask(T(w, 13, 2)) & bit(DIR_S)).toBe(0);
  });

  it('is never entered by a wandering walker', () => {
    const { w, exit } = parkWithExit();
    const rng = new Prng(11);
    for (const start of [T(w, 13, 1), T(w, 14, 5), T(w, 13, 5)]) {
      let tile = start;
      let from = DIR_NONE;
      for (let step = 0; step < 3000; step++) {
        const dir = nextDirection(w, tile, -1, rng, { ...DEFAULT_GUEST_OPTS, fromDir: from });
        if (dir === DIR_NONE) break;
        tile = w.map.neighbor(tile, dir);
        from = dir;
        expect(tile).not.toBe(exit);
      }
    }
  });
});

/**
 * Merry-go-round covering (10..12, 2..4). Its entrance is (11, 5) on the south side, so its front
 * is (11, 6); the queue runs south from there to an open end at (11, 7). Ordinary paths run past
 * both sides of the entrance.
 */
function parkWithEntrance(): { w: World; entrance: number; slot: number } {
  const w = flatWorld();
  layPath(w, [
    [10, 5],
    [12, 5],
    [9, 5],
    [13, 5],
    [13, 6],
    [13, 7],
    [13, 8],
    [12, 8],
    [11, 8],
    [10, 8],
    [9, 8],
    [9, 7],
    [9, 6],
    [8, 3],
  ]);
  layPath(w, [[11, 5]], true);
  layPath(w, [[11, 6]], true);
  layPath(w, [[11, 7]], true);
  const id = createRide(w, RideType.MerryGoRound, 11, 3);
  placeRideEntranceExit(w, id, { x: 11, y: 5 }, { x: 9, y: 3 });
  refreshQueueIndex(w);
  return { w, entrance: T(w, 11, 5), slot: w.rides.idToSlot[id] };
}

describe('ride entrance', () => {
  it('connects only to the queue on its front edge', () => {
    const { w, entrance } = parkWithEntrance();
    expect(w.map.pathEdges(entrance)).toBe(bit(DIR_S));
    expect(w.map.pathEdges(T(w, 10, 5)) & bit(DIR_E)).toBe(0);
    expect(w.map.pathEdges(T(w, 12, 5)) & bit(DIR_W)).toBe(0);
  });

  it('is not joined by a queue piece laid beside it', () => {
    const { w, entrance } = parkWithEntrance();
    layPath(w, [[10, 5]], true);
    refreshQueueIndex(w);
    expect(w.map.pathEdges(entrance)).toBe(bit(DIR_S));
    expect(w.map.pathEdges(T(w, 10, 5)) & bit(DIR_E)).toBe(0);
  });

  it('keeps the queue line running out of the front edge to its open end', () => {
    const { w, slot } = parkWithEntrance();
    expect(w.queues.owner[T(w, 11, 5)]).toBe(slot);
    expect(w.queues.owner[T(w, 11, 7)]).toBe(slot);
    expect(w.queues.openTile[slot]).toBe(T(w, 11, 7));
    expect(w.queues.joinTile[slot]).toBe(T(w, 11, 8));
  });

  it('is never reachable by ordinary walkers from the side paths', () => {
    const { w, entrance } = parkWithEntrance();
    expect(isReachable(w, T(w, 10, 5), entrance)).toBe(false);
    expect(isReachable(w, T(w, 12, 5), entrance)).toBe(false);
    expect(w.map.edgeMask(T(w, 10, 5)) & bit(DIR_E)).toBe(0);
  });
});

describe('a crowded path running past a ride exit', () => {
  it('lets only riders leaving the ride onto the exit, and always out through its front', () => {
    const w = flatWorld();
    layPath(w, [
      [13, 1],
      [13, 2],
      [13, 4],
      [13, 5],
      [13, 6],
    ]);
    layPath(w, [[13, 3]]);
    layPath(w, [
      [14, 1],
      [14, 2],
      [14, 3],
      [14, 4],
      [14, 5],
      [14, 6],
    ]);
    layPath(w, row(7, 11, 14));
    layPath(w, [[13, 7]]);
    layPath(w, [[11, 5]], true);
    layPath(w, [[11, 6]], true);
    const ride = openRide(w, RideType.MerryGoRound, [12, 4], [11, 5], [13, 3], [[11, 6]]);
    const exitTile = T(w, 13, 3);
    const front = T(w, 14, 3);

    const wanderers: number[] = [];
    for (let i = 0; i < 14; i++) {
      const slot = guestAt(w, 13 + (i % 2), [1, 2, 4, 5, 6][i % 5]);
      w.guests.cols.energy[slot] = 255;
      w.guests.cols.hunger[slot] = 255;
      w.guests.cols.thirst[slot] = 255;
      w.guests.cols.happiness[slot] = 255;
      wanderers.push(slot);
    }

    const wasOnExit = new Set<number>();
    let entries = 0;
    for (let tick = 0; tick < 6000; tick++) {
      rideSystem.update(w);
      rideQueueSystem.update(w);
      guestSystem.update(w);
      w.tick++;
      for (let slot = 0; slot < w.guests.count; slot++) {
        const tile = w.map.index(w.guests.cols.x[slot] >> 8, w.guests.cols.y[slot] >> 8);
        const here = tile === exitTile;
        if (here && !wasOnExit.has(slot)) entries++;
        if (!here && wasOnExit.has(slot)) {
          expect(tile).toBe(front);
        }
        if (here) wasOnExit.add(slot);
        else wasOnExit.delete(slot);
      }
    }
    expect(w.rides.cols.guestsServed[ride]).toBeGreaterThan(0);
    expect(entries).toBeLessThanOrEqual(w.rides.cols.guestsServed[ride]);
  });
});
