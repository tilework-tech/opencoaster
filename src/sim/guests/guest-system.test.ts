import { describe, expect, it } from 'vitest';
import { hashWorld } from '../core/hash';
import { LedgerCategory, PriceMode } from '../economy/ledger';
import { VoucherKind } from '../economy/vouchers';
import { flatWorld, guestAt, layPath, openRide, row } from '../integration/fixtures';
import { RIDE_CATALOG, RideType } from '../rides/ride-types';
import { RideState } from '../rides/ride-store';
import { getRideValueCents } from '../rides/ride-operations';
import { RIDE_PRICE_FLOOR_CENTS } from './willingness';
import { isReachable } from '../pathfinding';
import { rideQueueSystem } from '../rides/queue-system';
import { refreshQueueIndex } from '../rides/queue-lines';
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

function runGuestOnly(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    guestSystem.update(w);
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
function corridorWithRide(maxGuests = 64): { w: World; ride: number } {
  const w = flatWorld(24, 5, maxGuests);
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
  it('loses two hunger points and gains one toilet point every 128 ticks', () => {
    const w = flatWorld();
    spawnGuest(w);
    w.weather.temperature = 20;
    w.guests.cols.hunger[0] = 200;
    w.guests.cols.thirst[0] = 200;
    w.guests.cols.toilet[0] = 10;
    w.guests.cols.energy[0] = 100;
    w.tick = 1;
    for (let tick = 1; tick < 128; tick++) {
      w.tick = tick;
      guestSystem.update(w);
    }
    expect(w.guests.cols.hunger[0]).toBe(200);
    expect(w.guests.cols.thirst[0]).toBe(200);
    w.tick = 128;
    guestSystem.update(w);
    expect(w.guests.cols.hunger[0]).toBe(198);
    expect(w.guests.cols.thirst[0]).toBe(200);
    expect(w.guests.cols.toilet[0]).toBe(11);
    expect(w.guests.cols.energy[0]).toBe(100);
  });

  it('loses one thirst point per need update at 21 C', () => {
    const w = flatWorld();
    const slot = guestAt(w, 4, 5);
    w.weather.temperature = 21;
    w.guests.cols.thirst[slot] = 200;
    w.tick = 128;

    guestSystem.update(w);

    expect(w.guests.cols.thirst[slot]).toBe(199);
  });

  it('keeps comfortable happiness steady between idle-motive updates', () => {
    const w = flatWorld();
    const slot = guestAt(w, 4, 5);
    const g = w.guests.cols;
    g.happiness[slot] = 200;
    g.happinessTarget[slot] = 200;
    g.energy[slot] = 255;
    g.hunger[slot] = 200;
    g.thirst[slot] = 200;
    g.toilet[slot] = 0;
    g.nausea[slot] = 80;
    g.state[slot] = GuestState.Riding;
    w.tick = 128 - w.guests.slotToId[slot];

    guestSystem.update(w);

    expect(g.happinessTarget[slot]).toBe(200);
    expect(g.happiness[slot]).toBe(200);
    expect(g.nausea[slot]).toBe(78);
  });

  it('moves happiness toward its need-adjusted target on the 512-tick idle cadence', () => {
    const w = flatWorld();
    const slot = guestAt(w, 4, 5);
    const g = w.guests.cols;
    g.happiness[slot] = 130;
    g.happinessTarget[slot] = 130;
    g.energy[slot] = 50;
    g.hunger[slot] = 9;
    g.thirst[slot] = 9;
    g.toilet[slot] = 195;
    w.tick = 512 - w.guests.slotToId[slot];

    guestSystem.update(w);

    expect(g.happinessTarget[slot]).toBe(124);
    expect(g.happiness[slot]).toBe(126);
    expect(g.energy[slot]).toBe(49);
  });

  it('spawns guests with original energy bounds and four nausea-tolerance buckets', () => {
    const w = flatWorld(32);
    w.rng.seed(1);
    for (let i = 0; i < 256; i++) spawnGuest(w);
    const replay = flatWorld(32);
    replay.rng.seed(1);
    for (let i = 0; i < 256; i++) spawnGuest(replay);
    const energy = Array.from(w.guests.cols.energy.slice(0, w.guests.count));
    const tolerance = Array.from(w.guests.cols.nauseaTolerance.slice(0, w.guests.count));
    expect(Math.min(...energy)).toBe(65);
    expect(energy.every((value) => value >= 65 && value <= 128)).toBe(true);
    expect(Math.max(...energy)).toBe(128);
    expect(new Set(tolerance)).toEqual(new Set([0, 1, 2, 3]));
    expect(hashWorld(w)).toBe(hashWorld(replay));
  });

  it('leaves a first-time guest after five periods only when no ride can be chosen', () => {
    const w = flatWorld(16, 8);
    layPath(w, row(5, 2, 8));
    setParkEntrance(w, 2, 5);
    const slot = guestAt(w, 4, 5);
    w.guests.cols.visitTicks[slot] = 10_236;
    w.tick = 10_239 - w.guests.slotToId[slot];

    guestSystem.update(w);
    expect(w.guests.cols.state[slot]).not.toBe(GuestState.Leaving);

    w.tick = 10_240 - w.guests.slotToId[slot];
    guestSystem.update(w);

    expect(w.guests.cols.state[slot]).toBe(GuestState.Leaving);
    expect([
      w.guests.cols.thought0[slot],
      w.guests.cols.thought1[slot],
      w.guests.cols.thought2[slot],
      w.guests.cols.thought3[slot],
    ]).toContain(GuestThought.Leaving);
  });

  it('sends a first-time guest toward an available ride instead of leaving for low cash', () => {
    for (let seed = 1; seed <= 256; seed++) {
      const { w, ride } = corridorWithRide();
      const slot = guestAt(w, 2, 5);
      w.guests.cols.cash[slot] = 0;
      w.guests.cols.visitTicks[slot] = 10_236;
      w.tick = 10_240 - w.guests.slotToId[slot];
      w.rng.seed(seed);

      guestSystem.update(w);

      expect(w.guests.cols.state[slot]).not.toBe(GuestState.Leaving);
      expect(w.guests.cols.targetRide[slot]).toBe(w.rides.slotToId[ride]);
    }
  });

  it('only repeats a ride when guest needs and a random roll allow it', () => {
    const repeatTrips = (seed: number, happiness: number): number => {
      const { w, ride } = corridorWithRide(1);
      layPath(w, [[13, 4], [13, 5], [12, 5], ...row(6, 9, 12)]);
      w.rng.seed(seed);
      const slot = guestAt(w, 2, 5);
      w.guests.cols.happiness[slot] = 255;
      runUntil(w, () => w.rides.cols.guestsServed[ride] === 1);
      for (let tick = 0; tick < 12000; tick++) {
        w.guests.cols.happiness[slot] = happiness;
        w.guests.cols.energy[slot] = 255;
        w.guests.cols.hunger[slot] = 255;
        w.guests.cols.thirst[slot] = 255;
        w.guests.cols.toilet[slot] = 0;
        w.guests.cols.nausea[slot] = 0;
        run(w, 1);
      }
      return w.rides.cols.guestsServed[ride];
    };

    expect(repeatTrips(1, 100)).toBe(1);
    expect(
      Math.max(...Array.from({ length: 8 }, (_, i) => repeatTrips(i + 1, 255))),
    ).toBeGreaterThan(1);
    expect(repeatTrips(4, 255)).toBe(repeatTrips(4, 255));
  });

  it('randomly balks from an unhappy queue after the wait threshold and is deterministic', () => {
    const make = () => {
      const { w, ride } = corridorWithRide();
      for (let i = 0; i < 20; i++) {
        const slot = guestAt(w, 9, 5);
        w.guests.cols.targetRide[slot] = w.rides.slotToId[ride];
        w.guests.cols.state[slot] = GuestState.Waiting;
        w.guests.cols.happiness[slot] = 40;
        w.guests.cols.hunger[slot] = 255;
        w.guests.cols.thirst[slot] = 255;
        w.guests.cols.energy[slot] = 255;
      }
      return w;
    };
    const first = make();
    const second = make();
    runGuestOnly(first, 9000);
    runGuestOnly(second, 9000);
    const waiting = Array.from(first.guests.cols.state.slice(0, first.guests.count)).filter(
      (state) => state === GuestState.Waiting,
    ).length;
    const balked = Array.from(first.guests.cols.state.slice(0, first.guests.count)).filter(
      (_, slot) =>
        first.guests.cols.thought0[slot] === GuestThought.QueueTooLong ||
        first.guests.cols.thought1[slot] === GuestThought.QueueTooLong ||
        first.guests.cols.thought2[slot] === GuestThought.QueueTooLong ||
        first.guests.cols.thought3[slot] === GuestThought.QueueTooLong,
    ).length;
    expect(waiting).toBeGreaterThan(0);
    expect(balked).toBeGreaterThan(0);
    expect(hashWorld(first)).toBe(hashWorld(second));
  });

  it('does not balk before the wait threshold or when the queue guest is happy', () => {
    const make = (happiness: number) => {
      const { w, ride } = corridorWithRide();
      const slot = guestAt(w, 9, 5);
      w.guests.cols.targetRide[slot] = w.rides.slotToId[ride];
      w.guests.cols.state[slot] = GuestState.Waiting;
      w.guests.cols.happiness[slot] = happiness;
      w.guests.cols.hunger[slot] = 255;
      w.guests.cols.thirst[slot] = 255;
      w.guests.cols.energy[slot] = 255;
      return w;
    };
    const early = make(40);
    const happy = make(200);

    runGuestOnly(early, 2600);
    runGuestOnly(happy, 3000);

    expect(early.guests.cols.state[0]).toBe(GuestState.Waiting);
    expect(happy.guests.cols.state[0]).toBe(GuestState.Waiting);
    expect(happy.guests.cols.thought0[0]).not.toBe(GuestThought.QueueTooLong);
    expect(happy.guests.cols.thought1[0]).not.toBe(GuestThought.QueueTooLong);
    expect(happy.guests.cols.thought2[0]).not.toBe(GuestThought.QueueTooLong);
    expect(happy.guests.cols.thought3[0]).not.toBe(GuestThought.QueueTooLong);
  });

  it('keeps a happy guest in the thrill queue before their wait limit', () => {
    const { w, ride } = corridorWithRide();
    const slot = guestAt(w, 11, 5);
    w.guests.cols.targetRide[slot] = w.rides.slotToId[ride];
    w.guests.cols.happiness[slot] = 200;
    w.guests.cols.happinessTarget[slot] = 200;
    w.guests.cols.hunger[slot] = 255;
    w.guests.cols.thirst[slot] = 255;
    w.guests.cols.energy[slot] = 255;

    runGuestOnly(w, 4300);

    expect(w.guests.cols.state[slot]).toBe(GuestState.Waiting);
    expect(w.guests.cols.thought0[slot]).not.toBe(GuestThought.QueueTooLong);
    expect(w.guests.cols.thought1[slot]).not.toBe(GuestThought.QueueTooLong);
    expect(w.guests.cols.thought2[slot]).not.toBe(GuestThought.QueueTooLong);
    expect(w.guests.cols.thought3[slot]).not.toBe(GuestThought.QueueTooLong);
  });

  it('times out a happy guest waiting for a busy facility', () => {
    const w = flatWorld();
    layPath(w, row(5, 2, 20));
    const stall = openRide(w, RideType.FoodStall, [9, 4], [9, 5], [10, 4]);
    const waiting = guestAt(w, 9, 5);
    const serving = guestAt(w, 9, 5);
    const g = w.guests.cols;
    g.state[waiting] = GuestState.Waiting;
    g.targetRide[waiting] = w.rides.slotToId[stall];
    g.patience[waiting] = 4;
    g.happiness[waiting] = 200;
    g.state[serving] = GuestState.Shopping;
    g.targetRide[serving] = w.rides.slotToId[stall];

    runGuestOnly(w, 4);

    expect(g.state[waiting]).toBe(GuestState.Wandering);
    expect(g.targetRide[waiting]).toBe(-1);
  });
});

describe('walking the footpaths', () => {
  it('keeps the selected ride while a guest walks through its queue', () => {
    const { w, ride } = corridorWithRide();
    const slot = guestAt(w, 2, 5);
    w.guests.cols.happiness[slot] = 255;
    runUntil(w, () => w.guests.cols.state[slot] === GuestState.Queuing);
    const target = w.guests.cols.targetRide[slot];
    expect(target).toBe(w.rides.slotToId[ride]);
    run(w, 4);
    expect(w.guests.cols.state[slot]).toBe(GuestState.Queuing);
    expect(w.guests.cols.targetRide[slot]).toBe(target);
  });

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
    const { w, ride } = corridorWithRide(1);
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
    g.hunger[slot] = 10;
    g.thirst[slot] = 200;
    const cash = g.cash[slot];
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    expect(g.hunger[slot]).toBeGreaterThanOrEqual(180);
    expect(g.cash[slot]).toBe(cash - price);
    expect(w.economy.monthlyTotals[LedgerCategory.FoodDrinkSales]).toBe(price);
    expect(w.economy.monthlyTotals[LedgerCategory.FoodDrinkStock]).toBe(
      -RIDE_CATALOG[RideType.FoodStall].stockCostCents!,
    );
    expect(w.rides.cols.guestsServed[stall]).toBe(1);
  });

  it('sells drinks to a thirsty guest', () => {
    const { w, stall } = stallWorld(RideType.DrinkStall);
    const slot = guestAt(w, 4, 5);
    const g = w.guests.cols;
    g.thirst[slot] = 10;
    g.hunger[slot] = 200;
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    expect(g.thirst[slot]).toBeGreaterThan(180);
    expect(w.economy.monthlyTotals[LedgerCategory.FoodDrinkStock]).toBe(
      -RIDE_CATALOG[RideType.DrinkStall].stockCostCents!,
    );
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
    w.guests.cols.hunger[slot] = 10;
    w.guests.cols.cash[slot] = w.rides.cols.price[stall] - 1;
    run(w, 1500);
    expect(w.economy.monthlyTotals[LedgerCategory.FoodDrinkSales]).toBe(0);
  });

  it('only notices stalls within sight', () => {
    const w = flatWorld(32);
    layPath(w, row(5, 2, 30));
    openRide(w, RideType.FoodStall, [27, 4], [27, 5], [28, 4]);
    const slot = guestAt(w, 4, 5);
    w.guests.cols.hunger[slot] = 10;
    run(w, 8);
    expect(w.guests.cols.targetRide[slot]).toBe(-1);
  });
});

describe('arrivals', () => {
  function arrivals(
    w: World,
    provider: Parameters<typeof createGuestSystem>[0],
    ticks = 2000,
  ): number {
    const system = createGuestSystem(provider);
    for (let i = 0; i < ticks; i++) {
      w.tick = i;
      system.update(w);
    }
    return w.guests.count;
  }
  function gated(seed = 5): World {
    const w = flatWorld(24, seed);
    layPath(w, row(5, 2, 8));
    setParkEntrance(w, 2, 5);
    return w;
  }

  it('does not admit guests to a park without a gate', () => {
    const w = flatWorld();
    expect(arrivals(w, () => ({ generationProbability: 65_536, entranceFee: 0 }), 20)).toBe(0);
  });

  it('rolls once a tick against a probability out of 65536', () => {
    expect(arrivals(gated(), () => ({ generationProbability: 65_536, entranceFee: 0 }), 40)).toBe(
      40,
    );
    expect(arrivals(gated(), () => ({ generationProbability: 0, entranceFee: 0 }))).toBe(0);
    // 655/65536 is about one tick in a hundred: roughly 20 guests in 2000 ticks.
    const some = arrivals(gated(), () => ({ generationProbability: 655, entranceFee: 0 }));
    expect(some).toBeGreaterThan(8);
    expect(some).toBeLessThan(40);
  });

  it('charges the entrance fee for each arrival', () => {
    const w = gated();
    const guests = arrivals(w, () => ({ generationProbability: 655, entranceFee: 300 }));
    expect(guests).toBeGreaterThan(0);
    expect(w.economy.monthlyTotals[LedgerCategory.Admission]).toBe(300 * guests);
  });

  it('takes its probability from the economy and draws extra guests from a campaign', () => {
    const quiet = gated();
    quiet.economy.guestGeneration.probability = 300;
    const advertised = gated();
    advertised.economy.guestGeneration.probability = 300;
    advertised.economy.campaignId = 1;
    advertised.economy.campaignWeeksLeft = 4;
    expect(arrivals(advertised, undefined, 4000)).toBeGreaterThan(arrivals(quiet, undefined, 4000));
  });

  it('gives only campaign guests the campaign voucher', () => {
    const w = gated();
    w.economy.guestGeneration.probability = 0;
    w.economy.campaignId = 2;
    w.economy.campaignWeeksLeft = 4;
    w.economy.campaignTarget = 7;
    const guests = arrivals(w, undefined, 4000);
    expect(guests).toBeGreaterThan(0);
    for (let slot = 0; slot < guests; slot++) {
      expect(w.guests.cols.voucherKind[slot]).toBe(VoucherKind.FreeRide);
    }
    const natural = gated();
    natural.economy.guestGeneration.probability = 655;
    arrivals(natural, undefined, 2000);
    for (let slot = 0; slot < natural.guests.count; slot++) {
      expect(natural.guests.cols.voucherKind[slot]).toBe(VoucherKind.None);
    }
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

describe('campaign vouchers', () => {
  /** One guest arrives at the gate, under a campaign granting `kind` to `target`. */
  function admitUnder(kind: VoucherKind, target: number, fee: number): World {
    const w = flatWorld(16);
    layPath(w, row(5, 2, 9));
    expect(setParkEntrance(w, 2, 5)).toBe(true);
    const admission = () => ({
      generationProbability: 0,
      entranceFee: fee,
      campaign: { probability: 65_536, voucher: { kind, target }, targetRide: -1 },
    });
    createGuestSystem(admission).update(w);
    expect(w.guests.count).toBe(1);
    return w;
  }

  it('lets a free park-entry voucher in for nothing and uses it up at the gate', () => {
    const w = admitUnder(VoucherKind.FreeEntry, -1, 300);
    expect(w.economy.monthlyTotals[LedgerCategory.Admission]).toBe(0);
    expect(w.guests.cols.voucherKind[0]).toBe(VoucherKind.None);
  });

  it('halves the gate fee for a half-price park-entry voucher', () => {
    const w = admitUnder(VoucherKind.HalfPriceEntry, -1, 301);
    expect(w.economy.monthlyTotals[LedgerCategory.Admission]).toBe(150);
    expect(w.guests.cols.voucherKind[0]).toBe(VoucherKind.None);
  });

  it('charges the full gate fee to a guest the campaign carries no voucher for', () => {
    const w = admitUnder(VoucherKind.None, -1, 300);
    expect(w.economy.monthlyTotals[LedgerCategory.Admission]).toBe(300);
  });

  it('carries a free ride voucher with the guest, naming the ride it is for', () => {
    const w = admitUnder(VoucherKind.FreeRide, 7, 0);
    expect(w.guests.cols.voucherKind[0]).toBe(VoucherKind.FreeRide);
    expect(w.guests.cols.voucherTarget[0]).toBe(7);
  });

  it('directs arrivals toward the selected ride for both ride campaigns', () => {
    for (const campaignId of [2, 5]) {
      const { w } = corridorWithRide();
      layPath(w, [
        [4, 6],
        [4, 7],
        [4, 8],
        [4, 9],
      ]);
      layPath(
        w,
        [
          [7, 9],
          [6, 9],
          [5, 9],
        ],
        true,
      );
      layPath(w, [[8, 8]]);
      const promotedRide = openRide(
        w,
        RideType.MerryGoRound,
        [7, 8],
        [7, 9],
        [8, 8],
        [
          [6, 9],
          [5, 9],
        ],
      );
      expect(setParkEntrance(w, 2, 5)).toBe(true);
      const promotedRideId = w.rides.slotToId[promotedRide];
      expect(w.rides.cols.state[promotedRide]).toBe(RideState.Open);
      refreshQueueIndex(w);
      expect(w.queues.hasQueue[promotedRide]).toBe(1);
      expect(isReachable(w, w.map.index(2, 5), w.queues.joinTile[promotedRide])).toBe(true);
      w.economy.campaignId = campaignId;
      w.economy.campaignTarget = promotedRideId;
      w.economy.campaignWeeksLeft = 1;
      w.economy.guestGeneration.probability = 0;
      w.rng.int = () => 0;

      createGuestSystem().update(w);

      expect(w.guests.count).toBe(1);
      expect(w.guests.cols.targetRide[0]).toBe(promotedRideId);
      expect(w.guests.cols.voucherKind[0]).toBe(
        campaignId === 2 ? VoucherKind.FreeRide : VoucherKind.None,
      );
      if (campaignId === 2) expect(w.guests.cols.voucherTarget[0]).toBe(promotedRideId);
    }
  });

  it('rides the named ride for nothing and spends the voucher', () => {
    const { w, ride } = corridorWithRide();
    const id = w.rides.slotToId[ride];
    w.economy.priceMode = PriceMode.PerRide;
    w.rides.cols.price[ride] = 150;
    const slot = guestAt(w, 2, 5);
    w.guests.cols.happiness[slot] = 255;
    w.guests.cols.voucherKind[slot] = VoucherKind.FreeRide;
    w.guests.cols.voucherTarget[slot] = id;
    const cash = w.guests.cols.cash[slot];
    runUntil(w, () => w.guests.cols.state[slot] === GuestState.Riding);
    expect(w.guests.cols.cash[slot]).toBe(cash);
    expect(w.economy.monthlyTotals[LedgerCategory.RideTickets]).toBe(0);
    expect(w.guests.cols.voucherKind[slot]).toBe(VoucherKind.None);
  });

  it('keeps a free ride voucher that names a different ride and pays the fare', () => {
    const { w, ride } = corridorWithRide();
    const id = w.rides.slotToId[ride];
    w.economy.priceMode = PriceMode.PerRide;
    w.rides.cols.price[ride] = 150;
    const slot = guestAt(w, 2, 5);
    w.guests.cols.happiness[slot] = 255;
    w.guests.cols.voucherKind[slot] = VoucherKind.FreeRide;
    w.guests.cols.voucherTarget[slot] = id + 100;
    const cash = w.guests.cols.cash[slot];
    runUntil(w, () => w.guests.cols.state[slot] === GuestState.Riding);
    expect(w.guests.cols.cash[slot]).toBe(cash - 150);
    expect(w.guests.cols.voucherKind[slot]).toBe(VoucherKind.FreeRide);
    expect(w.guests.cols.voucherTarget[slot]).toBe(id + 100);
  });

  it.each([
    ['food stall', RideType.FoodStall],
    ['burger stall', RideType.BurgerStall],
  ])('feeds a guest holding a food voucher at the named %s for nothing', (_label, type) => {
    const w = flatWorld();
    layPath(w, row(5, 2, 20));
    const stall = openRide(w, type, [9, 4], [9, 5], [10, 4]);
    const id = w.rides.slotToId[stall];
    const slot = guestAt(w, 4, 5);
    const g = w.guests.cols;
    g.hunger[slot] = 10;
    g.thirst[slot] = 200;
    g.voucherKind[slot] = VoucherKind.FreeFoodOrDrink;
    g.voucherTarget[slot] = id;
    const cash = g.cash[slot];
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    expect(g.hunger[slot]).toBeGreaterThan(170);
    expect(g.cash[slot]).toBe(cash);
    expect(w.economy.monthlyTotals[LedgerCategory.FoodDrinkSales]).toBe(0);
    expect(g.voucherKind[slot]).toBe(VoucherKind.None);
  });

  it('walks a hungry guest to a burger stall, which serves food rather than drink', () => {
    const w = flatWorld();
    layPath(w, row(5, 2, 20));
    const stall = openRide(w, RideType.BurgerStall, [9, 4], [9, 5], [10, 4]);
    const slot = guestAt(w, 4, 5);
    const g = w.guests.cols;
    g.hunger[slot] = 10;
    g.thirst[slot] = 200;
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    expect(g.hunger[slot]).toBeGreaterThan(170);
    expect(g.thirst[slot]).toBeGreaterThan(150);
  });
});

const FOOD_VALUE = 190;

describe('price willingness', () => {
  const thoughts = (w: World, slot: number): number[] => {
    const g = w.guests.cols;
    return [g.thought0[slot], g.thought1[slot], g.thought2[slot], g.thought3[slot]];
  };

  function perRideCorridor(price: number): { w: World; ride: number; slot: number } {
    const { w, ride } = corridorWithRide();
    w.economy.priceMode = PriceMode.PerRide;
    w.rides.cols.price[ride] = price;
    const slot = guestAt(w, 2, 5);
    w.guests.cols.happiness[slot] = 255;
    w.guests.cols.cash[slot] = 5000;
    return { w, ride, slot };
  }

  function rideLimit(): number {
    const { w, ride } = corridorWithRide();
    return Math.max(RIDE_PRICE_FLOOR_CENTS, 2 * getRideValueCents(w, w.rides.slotToId[ride]));
  }

  it('rides at a ticket price within twice the ride value', () => {
    const { w, ride, slot } = perRideCorridor(Math.min(rideLimit(), 200));
    run(w, 3000);
    expect(w.rides.cols.guestsServed[ride]).toBeGreaterThan(0);
    expect(w.guests.cols.cash[slot]).toBeLessThan(5000);
  });

  it('refuses a ticket above twice the ride value and thinks it is poor value', () => {
    const { w, ride, slot } = perRideCorridor(rideLimit() + 1);
    run(w, 3000);
    expect(w.rides.cols.guestsServed[ride]).toBe(0);
    expect(w.guests.cols.cash[slot]).toBe(5000);
    expect(w.economy.monthlyTotals[LedgerCategory.RideTickets]).toBe(0);
    expect(thoughts(w, slot)).toContain(GuestThought.BadValue);
  });

  function stallAt(type: RideType, price: number): { w: World; stall: number; slot: number } {
    const w = flatWorld();
    layPath(w, row(5, 2, 20));
    const stall = openRide(w, type, [9, 4], [9, 5], [10, 4]);
    w.rides.cols.price[stall] = price;
    const slot = guestAt(w, 4, 5);
    w.guests.cols.hunger[slot] = 10;
    w.guests.cols.thirst[slot] = 10;
    w.guests.cols.cash[slot] = 5000;
    return { w, stall, slot };
  }

  it('buys food priced at its base value', () => {
    const { w, stall } = stallAt(RideType.FoodStall, FOOD_VALUE);
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    expect(w.economy.monthlyTotals[LedgerCategory.FoodDrinkSales]).toBe(FOOD_VALUE);
  });

  it('walks away from food priced beyond what even a delighted guest tolerates', () => {
    const { w, stall, slot } = stallAt(RideType.FoodStall, FOOD_VALUE + 284);
    w.guests.cols.happiness[slot] = 255;
    run(w, 3000);
    expect(w.rides.cols.guestsServed[stall]).toBe(0);
    expect(w.guests.cols.cash[slot]).toBe(5000);
    expect(thoughts(w, slot)).toContain(GuestThought.BadValue);
  });
});
