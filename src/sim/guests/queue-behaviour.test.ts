import { describe, expect, it } from 'vitest';
import { TILE_UNITS } from '../core/constants';
import type { World } from '../core/world';
import { flatWorld, guestAt, layPath, openRide, row } from '../integration/fixtures';
import { rideQueueSystem } from '../rides/queue-system';
import { rideQueueCapacity, setRideOpen } from '../rides/ride-operations';
import { rideSystem } from '../rides/ride-system';
import { RideType } from '../rides/ride-types';
import { GuestState, GuestThought, spawnGuest } from './guest-store';
import { guestSystem } from './guest-system';
import { hashWorld } from '../core/hash';
import { setParkEntrance } from './park';
import { Surface } from '../map/tile-map';

/** Main path along y=5, a queue along y=5 into a ride at (11, 4), exit at (12, 4). */
function parkWithLongQueue(queueTiles = 7): { w: World; ride: number } {
  const w = flatWorld();
  const first = 12 - queueTiles;
  layPath(w, row(5, 2, first - 1));
  layPath(w, row(5, first, 11), true);
  layPath(w, [[12, 4], [12, 5], ...row(6, first - 1, 12), [first - 1, 5]]);
  const chain: Array<[number, number]> = [];
  for (let x = 10; x >= first - 1; x--) chain.push([x, 5]);
  const ride = openRide(w, RideType.MerryGoRound, [11, 4], [11, 5], [12, 4], chain);
  w.rides.cols.capacity[ride] = 2;
  return { w, ride };
}

function step(w: World, ticks: number, onTick?: () => void, withRide = true): void {
  for (let i = 0; i < ticks; i++) {
    if (withRide) {
      rideSystem.update(w);
      rideQueueSystem.update(w);
    }
    guestSystem.update(w);
    w.tick++;
    onTick?.();
  }
}

function tileOf(w: World, slot: number): number {
  return w.map.index(w.guests.cols.x[slot] >> 8, w.guests.cols.y[slot] >> 8);
}

function sendToRide(w: World, ride: number, x = 2): number {
  const slot = guestAt(w, x, 5);
  const g = w.guests.cols;
  g.targetRide[slot] = w.rides.slotToId[ride];
  g.patience[slot] = 2400;
  g.approachGap[slot] = 0xffff;
  g.happiness[slot] = 200;
  g.energy[slot] = 255;
  g.hunger[slot] = 255;
  g.thirst[slot] = 255;
  g.cash[slot] = 9000;
  return slot;
}

describe('queuing guests', () => {
  it('keeps waiting arrivals on separate path tiles and replays the same join order', () => {
    const createCrowd = () => {
      const { w, ride } = parkWithLongQueue(7);
      guestSystem.update(w);
      const rideId = w.rides.slotToId[ride];
      const queueTiles = [w.queues.openTile[ride]];
      const g = w.guests.cols;
      const queueSlots = queueTiles.map((tile, index) => {
        const slot = guestAt(w, tile % w.map.width, Math.floor(tile / w.map.width));
        g.state[slot] = GuestState.Queuing;
        g.targetRide[slot] = rideId;
        g.queueSeq[slot] = index + 1;
        g.x[slot] = (tile % w.map.width) * TILE_UNITS + TILE_UNITS / 2;
        g.y[slot] = Math.floor(tile / w.map.width) * TILE_UNITS + TILE_UNITS / 2;
        return { slot, tile, sequence: index + 1 };
      });
      const joinTile = w.queues.joinTile[ride];
      const pathTiles = [joinTile];
      const seen = new Set(pathTiles);
      for (let cursor = 0; cursor < pathTiles.length && pathTiles.length < 7; cursor++) {
        const tile = pathTiles[cursor]!;
        const neighbors = [
          { tile: tile + 1, dir: 0 },
          { tile: tile + w.map.width, dir: 1 },
          { tile: tile - 1, dir: 2 },
          { tile: tile - w.map.width, dir: 3 },
        ];
        for (const neighbor of neighbors) {
          if (
            seen.has(neighbor.tile) ||
            w.map.surface[neighbor.tile] !== Surface.Path ||
            w.map.isQueue(neighbor.tile) ||
            (w.map.pathEdges(tile) & (1 << neighbor.dir)) === 0 ||
            (w.map.pathEdges(neighbor.tile) & (1 << ((neighbor.dir + 2) & 3))) === 0
          )
            continue;
          seen.add(neighbor.tile);
          pathTiles.push(neighbor.tile);
          if (pathTiles.length === 7) break;
        }
      }
      if (pathTiles.length < 4) throw new Error('queue join has too few connected path tiles');
      const slots = pathTiles.map((tile) => {
        const x = tile % w.map.width;
        const y = Math.floor(tile / w.map.width);
        const slot = guestAt(w, x, y);
        g.x[slot] = x * TILE_UNITS + TILE_UNITS / 2;
        g.y[slot] = y * TILE_UNITS + TILE_UNITS / 2;
        g.targetRide[slot] = rideId;
        g.patience[slot] = 2400;
        g.approachGap[slot] = 0;
        g.happiness[slot] = 200;
        g.energy[slot] = 255;
        g.hunger[slot] = 255;
        g.thirst[slot] = 255;
        g.cash[slot] = 9000;
        g.heading[slot] = 0;
        return slot;
      });
      return { w, slots, queueSlots, rideId, pathTiles, joinTile };
    };
    const first = createCrowd();
    const replay = createCrowd();
    const holdQueue = (park: typeof first) => {
      for (const { slot, tile, sequence } of park.queueSlots) {
        const g = park.w.guests.cols;
        g.state[slot] = GuestState.Queuing;
        g.targetRide[slot] = park.rideId;
        g.queueSeq[slot] = sequence;
        g.x[slot] = (tile % park.w.map.width) * TILE_UNITS + TILE_UNITS / 2;
        g.y[slot] = Math.floor(tile / park.w.map.width) * TILE_UNITS + TILE_UNITS / 2;
      }
      guestSystem.update(park.w);
      park.w.tick++;
    };
    for (let tick = 0; tick < 80; tick++) {
      holdQueue(first);
      holdQueue(replay);
      const positions = first.slots.map((slot) => tileOf(first.w, slot));
      expect(
        new Set(positions).size,
        JSON.stringify({
          positions,
          joinTile: first.joinTile,
          pathTiles: first.pathTiles,
        }),
      ).toBe(positions.length);
      expect(positions).toEqual(first.pathTiles);
    }

    const guestsAtJoin = first.slots.filter((slot) => tileOf(first.w, slot) === first.joinTile);
    expect(guestsAtJoin).toEqual([first.slots[0]]);
    expect(first.w.guests.cols.targetRide[first.slots[1]]).toBe(first.rideId);
    expect(hashWorld(first.w)).toBe(hashWorld(replay.w));
  });

  it('wandering guests never walk onto queue tiles', () => {
    const { w, ride } = parkWithLongQueue();
    setRideOpen(w, w.rides.slotToId[ride], false);
    for (let i = 0; i < 12; i++) {
      const slot = guestAt(w, 2 + (i % 3), 5);
      w.guests.cols.happiness[slot] = 255;
    }
    step(w, 4000, () => {
      for (let s = 0; s < w.guests.count; s++) {
        if (w.guests.cols.state[s] === GuestState.Wandering) {
          expect(w.map.isQueue(tileOf(w, s))).toBe(false);
        }
      }
    });
  });

  it('enters the line only when it has chosen the ride, then queues single file', () => {
    const { w, ride } = parkWithLongQueue();
    const slots: number[] = [];
    for (let i = 0; i < 4; i++) {
      slots.push(sendToRide(w, ride));
      step(w, 40, undefined, false);
    }
    let sawQueuing = false;
    step(
      w,
      1500,
      () => {
        const seen = new Set<number>();
        for (const s of slots) {
          if (w.guests.cols.state[s] !== GuestState.Queuing) continue;
          sawQueuing = true;
          const tile = tileOf(w, s);
          expect(seen.has(tile)).toBe(false);
          seen.add(tile);
        }
      },
      false,
    );
    expect(sawQueuing).toBe(true);
    expect(slots.every((s) => w.map.isQueue(tileOf(w, s)))).toBe(true);
  });

  it('boards guests in the order they joined the line', () => {
    const { w, ride } = parkWithLongQueue();
    const slots: number[] = [];
    for (let i = 0; i < 9; i++) {
      slots.push(sendToRide(w, ride));
      step(w, 30);
    }
    const boarded: number[] = [];
    const seen = new Set<number>();
    step(w, 6000, () => {
      const tickBoarders: number[] = [];
      for (const s of slots) {
        if (!seen.has(s) && w.guests.cols.state[s] === GuestState.Riding) {
          seen.add(s);
          tickBoarders.push(w.guests.cols.queueSeq[s]);
        }
      }
      boarded.push(...tickBoarders.sort((a, b) => a - b));
    });
    expect(boarded.length).toBe(9);
    expect(boarded).toEqual([...boarded].sort((a, b) => a - b));
  });

  it('shuffles forward as the head of the line is served', () => {
    const { w, ride } = parkWithLongQueue();
    const slots = [] as number[];
    for (let i = 0; i < 7; i++) {
      slots.push(sendToRide(w, ride));
      step(w, 30, undefined, false);
    }
    step(w, 2500, undefined, false);
    const distances = slots.map((s) => w.queues.dist[tileOf(w, s)]).sort((a, b) => a - b);
    expect(distances.slice(0, 2)).toEqual([0, 0]);
    expect(new Set(distances.slice(2)).size).toBe(distances.length - 2);
    const before = distances[distances.length - 1];
    step(w, 3000);
    const after = slots
      .filter((s) => w.guests.cols.state[s] === GuestState.Queuing)
      .map((s) => w.queues.dist[tileOf(w, s)]);
    expect(Math.max(0, ...after)).toBeLessThan(before);
  });

  it('turns guests away when the line is full', () => {
    const { w, ride } = parkWithLongQueue(2);
    const capacity = rideQueueCapacity(w, ride);
    const slots: number[] = [];
    for (let i = 0; i < capacity + 8; i++) slots.push(sendToRide(w, ride));
    step(w, 2500, undefined, false);
    const inLine = slots.filter(
      (s) =>
        w.guests.cols.state[s] === GuestState.Queuing ||
        w.guests.cols.state[s] === GuestState.Waiting,
    );
    expect(inLine.length).toBeLessThanOrEqual(capacity);
    const turnedAway = slots.filter((s) => w.guests.cols.targetRide[s] < 0);
    expect(turnedAway.length).toBeGreaterThan(0);
    expect(
      turnedAway.some((s) =>
        [0, 1, 2, 3].some(
          (k) =>
            (w.guests.cols[`thought${k}` as 'thought0'][s] as number) === GuestThought.QueueTooLong,
        ),
      ),
    ).toBe(true);
  });

  it('loses patience, complains, and walks out through the open end', () => {
    const { w, ride } = parkWithLongQueue();
    const slot = sendToRide(w, ride);
    w.guests.cols.happiness[slot] = 20;
    step(w, 1200, undefined, false);
    expect(w.guests.cols.state[slot]).toBe(GuestState.Waiting);
    const thoughts = new Set<number>();
    let walkedOut = false;
    step(
      w,
      4000,
      () => {
        w.guests.cols.happiness[slot] = Math.min(w.guests.cols.happiness[slot], 20);
        thoughts.add(w.guests.cols.thought0[slot]);
        thoughts.add(w.guests.cols.thought1[slot]);
        thoughts.add(w.guests.cols.thought2[slot]);
        thoughts.add(w.guests.cols.thought3[slot]);
        if (w.guests.cols.state[slot] === GuestState.Wandering && !w.map.isQueue(tileOf(w, slot)))
          walkedOut = true;
      },
      false,
    );
    expect(thoughts.has(GuestThought.QueuingForAges)).toBe(true);
    expect(thoughts.has(GuestThought.QueueTooLong)).toBe(true);
    expect(walkedOut).toBe(true);
  });

  it('sends everyone out of the line when the ride closes', () => {
    const { w, ride } = parkWithLongQueue();
    const slots = [] as number[];
    for (let i = 0; i < 5; i++) {
      slots.push(sendToRide(w, ride));
      step(w, 30, undefined, false);
    }
    step(w, 2000, undefined, false);
    expect(slots.some((s) => w.guests.cols.state[s] === GuestState.Queuing)).toBe(true);
    setRideOpen(w, w.rides.slotToId[ride], false);
    step(w, 2500, undefined, false);
    for (const s of slots) {
      expect(w.guests.cols.state[s]).not.toBe(GuestState.Waiting);
      expect(w.map.isQueue(tileOf(w, s))).toBe(false);
    }
    expect(w.rides.cols.queueLength[ride]).toBe(0);
    void TILE_UNITS;
    void spawnGuest;
    void setParkEntrance;
  });
});
