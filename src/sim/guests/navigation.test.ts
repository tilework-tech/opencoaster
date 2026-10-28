import { describe, expect, it } from 'vitest';
import { hashWorld } from '../core/hash';
import { LedgerCategory } from '../economy/ledger';
import { flatWorld, guestAt, layPath, openRide, row } from '../integration/fixtures';
import { parkInputsSystem } from '../economy/park-inputs';
import { RideType } from '../rides/ride-types';
import { rideQueueSystem } from '../rides/queue-system';
import { rideSystem } from '../rides/ride-system';
import { TILE_UNITS } from '../core/constants';
import type { World } from '../core/world';
import { GuestState, GuestThought } from './guest-store';
import { guestSystem } from './guest-system';
import { setParkEntrance } from './park';
import { LOST_WANDER_TICKS, MAP_PRICE } from './navigation';

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    rideSystem.update(w);
    rideQueueSystem.update(w);
    guestSystem.update(w);
    w.tick++;
  }
}

function tileX(w: World, slot: number): number {
  return (w.guests.cols.x[slot] / TILE_UNITS) | 0;
}

function thoughts(w: World, slot: number): number[] {
  const g = w.guests.cols;
  return [g.thought0[slot], g.thought1[slot], g.thought2[slot], g.thought3[slot]];
}

/**
 * A spine along y=1 with a one-tile tooth under every tile past x=4, and a ride whose entrance
 * lies on a separate return corridor: the way there runs east along the spine, down, and back.
 * Nothing on the spine gets a guest closer to the entrance, and the entrance is out of sight of
 * a guest without a map until it has walked the whole spine.
 */
function trapWorld(): { w: World; slot: number } {
  const w = flatWorld(64);
  const east = 30;
  layPath(w, row(1, 2, east));
  for (let x = 5; x < east; x++) layPath(w, [[x, 2]]);
  layPath(w, [
    [east, 2],
    [east, 3],
  ]);
  layPath(w, row(4, 3, east));
  layPath(w, [[5, 7]]);
  layPath(
    w,
    [
      [3, 5],
      [3, 6],
    ],
    true,
  );
  openRide(w, RideType.MerryGoRound, [4, 9], [3, 6], [5, 7], [[3, 5]]);
  const slot = guestAt(w, 3, 1);
  return { w, slot };
}

describe('lost guests', () => {
  it('turns a guest who cannot find its destination into a lost wanderer who thinks so', () => {
    const { w, slot } = trapWorld();
    const g = w.guests.cols;
    for (let i = 0; i < 6000 && g.lostTicks[slot] === 0; i++) run(w, 1);
    expect(g.lostTicks[slot]).toBeGreaterThan(0);
    expect(thoughts(w, slot)).toContain(GuestThought.Lost);
    expect(g.targetRide[slot]).toBe(-1);
    expect(g.state[slot]).toBe(GuestState.Wandering);
  });

  it('stops being lost once the wander period is over', () => {
    const { w, slot } = trapWorld();
    const g = w.guests.cols;
    g.lostTicks[slot] = LOST_WANDER_TICKS;
    run(w, LOST_WANDER_TICKS + 8);
    expect(g.lostTicks[slot]).toBe(0);
  });

  it('counts a lost guest among the lost guests the park rating sees', () => {
    const { w, slot } = trapWorld();
    parkInputsSystem.update(w);
    expect(w.economy.inputs.lostGuests).toBe(0);
    w.guests.cols.lostTicks[slot] = LOST_WANDER_TICKS;
    parkInputsSystem.update(w);
    expect(w.economy.inputs.lostGuests).toBe(1);
  });
});

describe('stranded guests', () => {
  it('leaves the park when its footpath is cut off from the gate and no ride is reachable', () => {
    const w = flatWorld();
    layPath(w, [[5, 5]]);
    guestAt(w, 5, 5);
    expect(w.guests.count).toBe(1);
    run(w, 1200);
    expect(w.guests.count).toBe(0);
  });

  it('thinks it is lost while it waits to leave', () => {
    const w = flatWorld();
    layPath(w, [[5, 5]]);
    const slot = guestAt(w, 5, 5);
    run(w, 40);
    expect(w.guests.count).toBe(1);
    expect(w.guests.cols.lostTicks[slot]).toBeGreaterThan(0);
    expect(thoughts(w, slot)).toContain(GuestThought.Lost);
  });

  it('keeps a guest on a footpath connected to the gate in the park', () => {
    const w = flatWorld();
    layPath(w, row(1, 2, 10));
    guestAt(w, 1, 2);
    run(w, 1200);
    expect(w.guests.count).toBe(1);
  });
});

describe('park maps', () => {
  function kioskWorld(): { w: World; slot: number; kiosk: number } {
    const w = flatWorld();
    layPath(w, row(5, 2, 14));
    const kiosk = openRide(w, RideType.InformationKiosk, [8, 4], [8, 5], [9, 4]);
    const slot = guestAt(w, 4, 5);
    return { w, slot, kiosk };
  }

  it('sells a map to a lost guest who walks up to an information kiosk', () => {
    const { w, slot, kiosk } = kioskWorld();
    const g = w.guests.cols;
    g.lostTicks[slot] = LOST_WANDER_TICKS;
    const cash = g.cash[slot];
    const sales = w.economy.monthlyTotals[LedgerCategory.ShopSales];
    run(w, 1200);
    expect(g.hasMap[slot]).toBe(1);
    expect(g.lostTicks[slot]).toBe(0);
    expect(g.cash[slot]).toBe(cash - MAP_PRICE);
    expect(w.economy.monthlyTotals[LedgerCategory.ShopSales]).toBe(sales + MAP_PRICE);
    expect(w.rides.cols.guestsServed[kiosk]).toBe(1);
    expect(w.umbrellas[w.guests.slotToId[slot]]).toBe(0);
  });

  it('does not sell a map to a guest who is not lost', () => {
    const { w, slot } = kioskWorld();
    w.guests.cols.hunger[slot] = 0;
    run(w, 1200);
    expect(w.guests.cols.hasMap[slot]).toBe(0);
  });

  it('lets a guest with a map see further than one without', () => {
    const without = trapWorld();
    const mapped = trapWorld();
    mapped.w.guests.cols.hasMap[mapped.slot] = 1;
    run(without.w, 2400);
    run(mapped.w, 2400);
    expect(thoughts(mapped.w, mapped.slot)).not.toContain(GuestThought.Lost);
    expect(tileX(mapped.w, mapped.slot)).toBeGreaterThan(tileX(without.w, without.slot) + 4);
  });
});

describe('leaving guests', () => {
  it('keeps a leaving guest in the park when no footpath leads to the gate', () => {
    const w = flatWorld();
    layPath(w, row(5, 2, 8));
    layPath(w, row(10, 2, 8));
    const slot = guestAt(w, 2, 10);
    setParkEntrance(w, 2, 10);
    w.guests.cols.x[slot] = 6 * TILE_UNITS + 128;
    w.guests.cols.y[slot] = 5 * TILE_UNITS + 128;
    w.guests.cols.state[slot] = GuestState.Leaving;
    run(w, 600);
    expect(w.guests.count).toBe(1);
    expect(w.guests.cols.state[slot]).toBe(GuestState.Leaving);
  });

  it('walks a leaving guest from the far end of a long park to the gate', () => {
    const w = flatWorld(64);
    layPath(w, row(5, 2, 50));
    for (let x = 4; x < 50; x += 2) layPath(w, [[x, 6]]);
    const slot = guestAt(w, 2, 5);
    w.guests.cols.x[slot] = 50 * TILE_UNITS + 128;
    w.guests.cols.state[slot] = GuestState.Leaving;
    w.rng.int = (range) => range - 1;
    run(w, 8000);
    expect(w.guests.count).toBe(0);
  });

  it('is deterministic', () => {
    const make = (): World => {
      const { w } = trapWorld();
      return w;
    };
    const a = make();
    const b = make();
    run(a, 3000);
    run(b, 3000);
    expect(hashWorld(a)).toBe(hashWorld(b));
  });
});
