import { describe, expect, it } from 'vitest';
import { hashWorld } from '../core/hash';
import { LedgerCategory, PriceMode } from '../economy/ledger';
import { flatWorld, guestAt, layPath, openRide, row } from '../integration/fixtures';
import { RideType } from '../rides/ride-types';
import { rideQueueSystem } from '../rides/queue-system';
import { rideSystem } from '../rides/ride-system';
import { TILE_UNITS } from '../core/constants';
import type { World } from '../core/world';
import { GuestState, GuestThought, spawnGuest } from './guest-store';
import { createGuestSystem, guestSystem } from './guest-system';
import { setParkEntrance } from './park';

function run(w: World, ticks: number, system = guestSystem): void {
  for (let i = 0; i < ticks; i++) {
    rideSystem.update(w);
    rideQueueSystem.update(w);
    system.update(w);
    w.tick++;
  }
}

function runUntil(w: World, done: () => boolean, limit = 3000): void {
  for (let i = 0; i < limit && !done(); i++) run(w, 1);
  expect(done()).toBe(true);
}

function tileOf(w: World, slot: number): [number, number] {
  return [(w.guests.cols.x[slot] / TILE_UNITS) | 0, (w.guests.cols.y[slot] / TILE_UNITS) | 0];
}

/** Corridor along y=5 from x=2 to x=11 with a merry-go-round fed by a queue at its east end. */
function corridorWithRide(): { w: World; ride: number } {
  const w = flatWorld();
  layPath(w, row(5, 2, 9));
  layPath(w, row(5, 10, 11), true);
  layPath(w, [[12, 4]]);
  const ride = openRide(
    w,
    RideType.MerryGoRound,
    [11, 4],
    [11, 5],
    [12, 4],
    [
      [10, 5],
      [9, 5],
    ],
  );
  return { w, ride };
}

describe('guest needs', () => {
  it('decays needs and records a hunger thought on a guest update', () => {
    const w = flatWorld();
    spawnGuest(w);
    w.guests.cols.hunger[0] = 179;
    w.tick = 1;
    guestSystem.update(w);
    expect(w.guests.cols.hunger[0]).toBe(179);
    w.tick = 0;
    guestSystem.update(w);
    expect(w.guests.cols.hunger[0]).toBe(180);
    expect(w.guests.cols.thought0[0]).toBe(GuestThought.Hungry);
  });

  it('leaves the park when happiness and energy are exhausted', () => {
    const w = flatWorld();
    layPath(w, row(5, 2, 8));
    const slot = guestAt(w, 4, 5);
    w.guests.cols.happiness[slot] = 0;
    w.guests.cols.energy[slot] = 0;
    run(w, 16);
    expect(w.guests.cols.state[slot]).toBe(GuestState.Leaving);
    expect(w.guests.cols.thought0[slot]).toBe(GuestThought.Leaving);
  });
});

describe('walking the footpaths', () => {
  it('walks a queue to the ride, boards on dispatch, and steps out of the exit', () => {
    const { w, ride } = corridorWithRide();
    w.economy.priceMode = PriceMode.PerRide;
    w.rides.cols.price[ride] = 150;
    const slot = guestAt(w, 2, 5);
    const cash = w.guests.cols.cash[slot];
    w.guests.cols.happiness[slot] = 255;
    const seen = new Set<number>();
    for (let i = 0; i < 4000 && w.guests.cols.cash[slot] === cash; i++) {
      run(w, 1);
      const [tx, ty] = tileOf(w, slot);
      if (w.guests.cols.state[slot] !== GuestState.Riding) {
        expect(w.map.isWalkable(w.map.index(tx, ty))).toBe(true);
      }
      seen.add(w.guests.cols.state[slot]);
    }
    expect(seen.has(GuestState.Queuing)).toBe(true);
    expect(seen.has(GuestState.Waiting)).toBe(true);
    expect(w.guests.cols.state[slot]).toBe(GuestState.Riding);
    expect(w.guests.cols.cash[slot]).toBe(cash - 150);
    expect(w.economy.monthlyTotals[LedgerCategory.RideTickets]).toBe(150);
    expect(w.rides.cols.incomeCents[ride]).toBe(150);
    expect(w.rides.cols.queueLength[ride]).toBe(0);

    for (let i = 0; i < 2000 && w.guests.cols.state[slot] === GuestState.Riding; i++) run(w, 1);
    expect(w.guests.cols.state[slot]).toBe(GuestState.Wandering);
    expect(tileOf(w, slot)).toEqual([12, 4]);
    expect(w.rides.cols.guestsServed[ride]).toBe(1);
    expect(w.guests.cols.happiness[slot]).toBeGreaterThan(0);
  });

  it('rides for free unless the park charges per ride', () => {
    const { w, ride } = corridorWithRide();
    w.rides.cols.price[ride] = 150;
    const slot = guestAt(w, 2, 5);
    const cash = w.guests.cols.cash[slot];
    run(w, 2500);
    expect(w.rides.cols.cyclesCompleted[ride]).toBeGreaterThan(0);
    expect(w.guests.cols.cash[slot]).toBe(cash);
    expect(w.economy.monthlyTotals[LedgerCategory.RideTickets]).toBe(0);
  });

  it('keeps a far destination while the walk keeps getting closer', () => {
    const w = flatWorld(72);
    layPath(w, row(5, 2, 58));
    layPath(w, row(5, 59, 60), true);
    layPath(w, [[61, 4]]);
    openRide(
      w,
      RideType.MerryGoRound,
      [60, 4],
      [60, 5],
      [61, 4],
      [
        [59, 5],
        [58, 5],
      ],
    );
    const slot = guestAt(w, 2, 5);
    let dropped = false;
    for (let i = 0; i < 4000; i++) {
      run(w, 1);
      if (w.guests.cols.targetRide[slot] < 0) dropped = true;
    }
    expect(dropped).toBe(false);
    expect(tileOf(w, slot)[0]).toBeGreaterThan(40);
  });

  it('ignores rides it cannot reach by footpath', () => {
    const w = flatWorld();
    layPath(w, row(5, 2, 6));
    layPath(w, row(12, 2, 9), true);
    openRide(
      w,
      RideType.MerryGoRound,
      [9, 11],
      [9, 12],
      [10, 11],
      [
        [8, 12],
        [7, 12],
      ],
    );
    const slot = guestAt(w, 2, 5);
    run(w, 600);
    expect(w.guests.cols.targetRide[slot]).toBe(-1);
    expect(w.guests.cols.state[slot]).toBe(GuestState.Wandering);
  });

  it('despawns a leaving guest at the gate, and at once when the park has no gate', () => {
    const w = flatWorld();
    layPath(w, row(5, 2, 8));
    const slot = guestAt(w, 2, 5);
    w.guests.cols.x[slot] = 8 * TILE_UNITS + 128;
    w.guests.cols.state[slot] = GuestState.Leaving;
    run(w, 1200);
    expect(w.guests.count).toBe(0);

    const none = flatWorld();
    spawnGuest(none);
    none.guests.cols.state[0] = GuestState.Leaving;
    run(none, 8);
    expect(none.guests.count).toBe(0);
  });
});

describe('stalls and toilets', () => {
  function stallWorld(type: RideType): { w: World; stall: number } {
    const w = flatWorld();
    layPath(w, row(5, 2, 20));
    const stall = openRide(w, type, [9, 4], [9, 5], [10, 4]);
    return { w, stall };
  }

  it('sells food to a hungry guest who walks up to the stall', () => {
    const { w, stall } = stallWorld(RideType.FoodStall);
    const price = w.rides.cols.price[stall];
    const slot = guestAt(w, 4, 5);
    const g = w.guests.cols;
    g.hunger[slot] = 200;
    g.thirst[slot] = 0;
    const cash = g.cash[slot];
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    expect(g.hunger[slot]).toBeLessThan(80);
    expect(g.cash[slot]).toBe(cash - price);
    expect(w.economy.monthlyTotals[LedgerCategory.FoodDrinkSales]).toBe(price);
    expect(w.economy.monthlyTotals[LedgerCategory.FoodDrinkStock]).toBeLessThan(0);
    expect(w.rides.cols.guestsServed[stall]).toBe(1);
  });

  it('sells drinks to a thirsty guest', () => {
    const { w, stall } = stallWorld(RideType.DrinkStall);
    const slot = guestAt(w, 4, 5);
    const g = w.guests.cols;
    g.thirst[slot] = 220;
    g.hunger[slot] = 0;
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    expect(g.thirst[slot]).toBeLessThan(80);
  });

  it('lets a guest in need use the toilets', () => {
    const { w, stall } = stallWorld(RideType.Toilets);
    const slot = guestAt(w, 4, 5);
    w.guests.cols.toilet[slot] = 200;
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    expect(w.guests.cols.toilet[slot]).toBeLessThan(40);
  });

  it('does not buy when it cannot afford the item', () => {
    const { w, stall } = stallWorld(RideType.FoodStall);
    const slot = guestAt(w, 4, 5);
    w.guests.cols.hunger[slot] = 200;
    w.guests.cols.cash[slot] = w.rides.cols.price[stall] - 1;
    run(w, 1500);
    expect(w.economy.monthlyTotals[LedgerCategory.FoodDrinkSales]).toBe(0);
  });

  it('only notices stalls within sight', () => {
    const w = flatWorld(32);
    layPath(w, row(5, 2, 30));
    openRide(w, RideType.FoodStall, [27, 4], [27, 5], [28, 4]);
    const slot = guestAt(w, 4, 5);
    w.guests.cols.hunger[slot] = 200;
    run(w, 8);
    expect(w.guests.cols.targetRide[slot]).toBe(-1);
  });
});

describe('arrivals', () => {
  function arrivals(
    w: World,
    provider: Parameters<typeof createGuestSystem>[0],
    intervals = 200,
  ): number {
    const system = createGuestSystem(provider);
    for (let i = 0; i < intervals; i++) {
      w.tick = i * 80;
      system.update(w);
    }
    return w.guests.count;
  }
  function gated(): World {
    const w = flatWorld();
    layPath(w, row(5, 2, 8));
    setParkEntrance(w, 2, 5);
    return w;
  }

  it('does not admit guests to a park without a gate', () => {
    const w = flatWorld();
    expect(arrivals(w, () => ({ parkRating: 1000, entranceFee: 0 }), 20)).toBe(0);
  });

  it('brings in more guests at a higher rating, and none at an excessive fee', () => {
    const good = arrivals(gated(), () => ({ parkRating: 900, entranceFee: 0 }));
    const poor = arrivals(gated(), () => ({ parkRating: 100, entranceFee: 0 }));
    const dear = arrivals(gated(), () => ({ parkRating: 900, entranceFee: 50_000 }));
    expect(good).toBeGreaterThan(poor);
    expect(poor).toBeGreaterThan(0);
    expect(dear).toBe(0);
  });

  it('charges the gate fee and a campaign draws a bigger crowd', () => {
    const w = gated();
    w.economy.priceMode = PriceMode.Admission;
    w.economy.admissionPrice = 300;
    w.economy.parkRating = 400;
    const quiet = gated();
    quiet.economy.parkRating = 400;
    const guests = arrivals(w, undefined, 100);
    expect(guests).toBeGreaterThan(0);
    expect(w.economy.monthlyTotals[LedgerCategory.Admission]).toBe(300 * guests);

    const advertised = gated();
    advertised.economy.parkRating = 400;
    advertised.economy.campaignId = 1;
    advertised.economy.campaignWeeksLeft = 4;
    expect(arrivals(advertised, undefined, 100)).toBeGreaterThan(arrivals(quiet, undefined, 100));
  });
});

describe('determinism', () => {
  it('keeps guest outcomes identical for the same seed and tick sequence', () => {
    const make = (): World => {
      const { w } = corridorWithRide();
      w.economy.priceMode = PriceMode.PerRide;
      setParkEntrance(w, 2, 5);
      for (let i = 0; i < 30; i++) spawnGuest(w);
      return w;
    };
    const first = make();
    const second = make();
    run(first, 1500);
    run(second, 1500);
    expect(hashWorld(first)).toBe(hashWorld(second));
  });
});
