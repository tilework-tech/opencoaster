import { describe, expect, it } from 'vitest';
import { createGuestSystem } from './guest-system';
import { GuestState, GuestThought, spawnGuest } from './guest-store';
import { flatWorld, guestAt, layPath, openRide, row } from '../integration/fixtures';
import { rideQueueCapacity } from '../rides/ride-operations';
import { RideState } from '../rides/ride-store';
import { RideType } from '../rides/ride-types';
import type { World } from '../core/world';

const admission = () => ({ parkRating: 0, entranceFee: 0 });

function stepSystem(world: World, system: ReturnType<typeof createGuestSystem>, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    system.update(world);
    world.tick++;
  }
}

/** One guest on a footpath with one ride whose ratings the caller sets. */
function oneRide(ratings: { excitement: number; intensity: number; nausea: number }) {
  const world = flatWorld(24, 8);
  layPath(world, row(5, 3, 15));
  const guest = guestAt(world, 5, 5);
  world.guests.cols.preferredIntensity[guest] = 100;
  world.guests.cols.nauseaTolerance[guest] = 150;
  const ride = openRide(world, RideType.MerryGoRound, [8, 4], [8, 5], [8, 3], [[7, 5]]);
  world.rides.cols.excitement[ride] = ratings.excitement;
  world.rides.cols.intensity[ride] = ratings.intensity;
  world.rides.cols.nausea[ride] = ratings.nausea;
  createGuestSystem(admission).update(world);
  return { world, guest, ride };
}

describe('ride choice against ride ratings', () => {
  it('accepts a ride with coaster-like ratings', () => {
    const { world, guest, ride } = oneRide({ excitement: 526, intensity: 484, nausea: 128 });
    expect(world.guests.cols.targetRide[guest]).toBe(world.rides.slotToId[ride]);
  });

  it('refuses an ultra-extreme ride and thinks it too intense', () => {
    const { world, guest } = oneRide({ excitement: 900, intensity: 1500, nausea: 100 });
    expect(world.guests.cols.targetRide[guest]).toBe(-1);
    expect(world.guests.cols.thought0[guest]).toBe(GuestThought.TooIntense);
  });

  it('refuses a ride far more sickening than the guest tolerates', () => {
    const { world, guest } = oneRide({ excitement: 600, intensity: 400, nausea: 1500 });
    expect(world.guests.cols.targetRide[guest]).toBe(-1);
    expect(world.guests.cols.thought0[guest]).toBe(GuestThought.TooNauseous);
  });
});

describe('ride lines', () => {
  function crowdedRide() {
    const world = flatWorld(24, 8);
    layPath(world, row(5, 3, 15));
    const guest = guestAt(world, 5, 5);
    world.guests.cols.preferredIntensity[guest] = 100;
    const ride = openRide(world, RideType.MerryGoRound, [8, 4], [8, 5], [8, 3], [[7, 5]]);
    world.rides.cols.excitement[ride] = 500;
    world.rides.cols.intensity[ride] = 450;
    world.rides.cols.nausea[ride] = 0;
    const id = world.rides.slotToId[ride];
    const waiting: number[] = [];
    for (let i = 0; i < rideQueueCapacity(world, ride); i++) {
      expect(spawnGuest(world)).toBe(true);
      const slot = world.guests.count - 1;
      world.guests.cols.state[slot] = GuestState.Waiting;
      world.guests.cols.targetRide[slot] = id;
      world.guests.cols.patience[slot] = 3000;
      waiting.push(slot);
    }
    return { world, guest, ride, id, waiting };
  }

  it('counts the whole line, not just the head of the queue', () => {
    const { world, ride, waiting } = crowdedRide();
    createGuestSystem(admission).update(world);
    expect(world.rideLines.queued[ride]).toBe(waiting.length);
  });

  it('turns guests away from a ride whose line is full', () => {
    const { world, guest } = crowdedRide();
    createGuestSystem(admission).update(world);
    expect(world.guests.cols.targetRide[guest]).toBe(-1);
    expect(world.guests.cols.thought0[guest]).toBe(GuestThought.QueueTooLong);
  });

  it('accepts the guest again once the line has room', () => {
    const { world, guest, id, waiting } = crowdedRide();
    world.guests.cols.state[waiting[0]] = GuestState.Wandering;
    world.guests.cols.targetRide[waiting[0]] = -1;
    createGuestSystem(admission).update(world);
    expect(world.guests.cols.targetRide[guest]).toBe(id);
  });
});

describe('stall service', () => {
  function hungryQueue(count: number) {
    const world = flatWorld(24, 8);
    layPath(world, row(5, 3, 15));
    const stall = openRide(world, RideType.FoodStall, [8, 4], [8, 5], [9, 4]);
    world.rides.cols.price[stall] = 0;
    const guests: number[] = [];
    for (let i = 0; i < count; i++) {
      const slot = guestAt(world, 8, 5);
      world.guests.cols.hunger[slot] = 200;
      guests.push(slot);
    }
    return { world, stall, guests };
  }

  it('serves one guest at a time and everyone eventually', () => {
    const { world, stall, guests } = hungryQueue(3);
    const system = createGuestSystem(admission);
    let mostServing = 0;
    for (let i = 0; i < 600; i++) {
      system.update(world);
      world.tick++;
      const serving = guests.filter((g) => world.guests.cols.state[g] === GuestState.Shopping);
      mostServing = Math.max(mostServing, serving.length);
    }
    expect(mostServing).toBe(1);
    expect(world.rides.cols.guestsServed[stall]).toBe(3);
    for (const g of guests) expect(world.guests.cols.hunger[g]).toBeLessThan(100);
  });

  it('lets guests wait in line while the stall is busy', () => {
    const { world, guests } = hungryQueue(3);
    const system = createGuestSystem(admission);
    stepSystem(world, system, 8);
    const states = guests.map((g) => world.guests.cols.state[g]);
    expect(states.filter((s) => s === GuestState.Shopping)).toHaveLength(1);
    expect(states.filter((s) => s === GuestState.Waiting)).toHaveLength(2);
  });
});

describe('park capacity', () => {
  function arrivals(openRides: number): number {
    const world = flatWorld(24, 11);
    layPath(world, row(12, 3, 21));
    for (let i = 0; i < openRides; i++) {
      const x = 4 + i * 3;
      const ride = openRide(
        world,
        RideType.MerryGoRound,
        [x, 11],
        [x, 12],
        [x + 1, 11],
        [[x - 1, 12]],
      );
      world.rides.cols.excitement[ride] = 500;
    }
    const system = createGuestSystem(() => ({ parkRating: 900, entranceFee: 0 }));
    world.park.entranceX = 2;
    world.park.entranceY = 12;
    layPath(world, [[2, 12]]);
    stepSystem(world, system, 3000);
    return world.guests.count;
  }

  it('lets a park with more attractions hold more guests', () => {
    expect(arrivals(0)).toBeLessThanOrEqual(30);
    expect(arrivals(5)).toBeGreaterThan(30);
  });
});

describe('stall edge cases', () => {
  function stallWithGuests(type: RideType, count: number) {
    const world = flatWorld(24, 8);
    layPath(world, row(5, 3, 15));
    const stall = openRide(world, type, [8, 4], [8, 5], [9, 4]);
    world.rides.cols.price[stall] = 0;
    const guests: number[] = [];
    for (let i = 0; i < count; i++) {
      const slot = guestAt(world, 8, 5);
      world.guests.cols.toilet[slot] = 200;
      world.guests.cols.hunger[slot] = 200;
      guests.push(slot);
    }
    return { world, stall, guests };
  }

  it('serves two guests at once at toilets', () => {
    const { world, guests } = stallWithGuests(RideType.Toilets, 4);
    const system = createGuestSystem(admission);
    let most = 0;
    for (let i = 0; i < 400; i++) {
      system.update(world);
      world.tick++;
      most = Math.max(
        most,
        guests.filter((g) => world.guests.cols.state[g] === GuestState.Shopping).length,
      );
    }
    expect(most).toBe(2);
  });

  it('sends waiting guests away without a complaint when the stall closes', () => {
    const { world, stall, guests } = stallWithGuests(RideType.FoodStall, 3);
    const system = createGuestSystem(admission);
    stepSystem(world, system, 8);
    world.rides.cols.state[stall] = RideState.Closed;
    stepSystem(world, system, 16);
    for (const g of guests) {
      expect(world.guests.cols.state[g]).not.toBe(GuestState.Waiting);
      expect(world.guests.cols.thought0[g]).not.toBe(GuestThought.QueueTooLong);
    }
  });

  it('keeps further guests away from a stall whose line is already long', () => {
    const { world, stall, guests } = stallWithGuests(RideType.FoodStall, 12);
    const system = createGuestSystem(admission);
    stepSystem(world, system, 8);
    const state = (g: number) => world.guests.cols.state[g];
    expect(guests.filter((g) => state(g) === GuestState.Waiting)).toHaveLength(8);
    expect(guests.filter((g) => state(g) === GuestState.Wandering)).toHaveLength(3);
    expect(world.rideLines.queued[stall]).toBe(8);
  });
});
