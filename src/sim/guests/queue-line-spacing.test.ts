import { describe, expect, it } from 'vitest';
import type { World } from '../core/world';
import { flatWorld, guestAt, layPath, openRide, row } from '../integration/fixtures';
import { rideQueueSystem } from '../rides/queue-system';
import { rideSystem } from '../rides/ride-system';
import { RideType } from '../rides/ride-types';
import { GuestState } from './guest-store';
import { guestSystem } from './guest-system';

/** Main path along y=5, a queue of `queueTiles` tiles along y=5 into a ride at (11, 4). */
function park(queueTiles: number, capacity: number): { w: World; ride: number } {
  const w = flatWorld();
  const first = 12 - queueTiles;
  layPath(w, row(5, 2, first - 1));
  layPath(w, row(5, first, 11), true);
  layPath(w, [[12, 4], [12, 5], ...row(6, first - 1, 12), [first - 1, 5]]);
  const chain: Array<[number, number]> = [];
  for (let x = 10; x >= first - 1; x--) chain.push([x, 5]);
  const ride = openRide(w, RideType.MerryGoRound, [11, 4], [11, 5], [12, 4], chain);
  w.rides.cols.capacity[ride] = capacity;
  return { w, ride };
}

function step(w: World, ticks: number, withRide: boolean): void {
  for (let i = 0; i < ticks; i++) {
    if (withRide) {
      rideSystem.update(w);
      rideQueueSystem.update(w);
    }
    guestSystem.update(w);
    w.tick++;
  }
}

function send(w: World, ride: number): number {
  const slot = guestAt(w, 2, 5);
  const g = w.guests.cols;
  g.targetRide[slot] = w.rides.slotToId[ride];
  g.patience[slot] = 2400;
  g.lostCountdown[slot] = 200;
  g.happiness[slot] = 255;
  g.energy[slot] = 255;
  g.hunger[slot] = 255;
  g.thirst[slot] = 255;
  g.cash[slot] = 9000;
  return slot;
}

function inLine(w: World, slots: number[]): number[] {
  const g = w.guests.cols;
  return slots
    .filter((s) => g.state[s] === GuestState.Queuing || g.state[s] === GuestState.Waiting)
    .sort((a, b) => g.queueSeq[a] - g.queueSeq[b]);
}

/** Distance from the ride entrance along a straight queue: the line runs west along y=5. */
function lineDistance(w: World, slot: number): number {
  const entranceX = 11 * 256 + 128;
  return entranceX - w.guests.cols.x[slot];
}

describe('queue line spacing', () => {
  it('spreads queued guests along the line, a fixed spacing apart, in joining order', () => {
    const { w, ride } = park(6, 2);
    const slots: number[] = [];
    for (let i = 0; i < 10; i++) {
      slots.push(send(w, ride));
      step(w, 24, false);
    }
    step(w, 3000, false);
    const line = inLine(w, slots);
    expect(line.length).toBe(10);
    const along = line.map((s) => lineDistance(w, s));
    for (let i = 1; i < along.length; i++) {
      expect(along[i]! - along[i - 1]!, `guest ${i} behind guest ${i - 1}`).toBeGreaterThanOrEqual(
        60,
      );
    }
    expect(new Set(line.map((s) => w.guests.cols.x[s])).size).toBe(10);
    expect(w.rides.cols.queueLength[ride]).toBeLessThanOrEqual(2);
  });

  it('keeps the whole line in distinct places as it shuffles forward with the ride running', () => {
    const { w, ride } = park(6, 2);
    const slots: number[] = [];
    for (let i = 0; i < 12; i++) {
      slots.push(send(w, ride));
      step(w, 24, true);
    }
    let maxWaiting = 0;
    for (let t = 0; t < 4000; t++) {
      step(w, 1, true);
      const line = inLine(w, slots);
      const along = line.map((s) => lineDistance(w, s));
      for (let i = 1; i < along.length; i++) {
        expect(along[i]! - along[i - 1]!).toBeGreaterThanOrEqual(48);
      }
      maxWaiting = Math.max(maxWaiting, line.length);
    }
    expect(maxWaiting).toBeGreaterThan(4);
    expect(slots.some((s) => w.guests.cols.state[s] === GuestState.Riding)).toBe(true);
  });
});
