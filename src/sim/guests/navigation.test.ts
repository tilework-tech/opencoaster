import { describe, expect, it } from 'vitest';
import { hashWorld } from '../core/hash';
import { LedgerCategory } from '../economy/ledger';
import {
  createRideAtCorner,
  flatWorld,
  guestAt,
  layPath,
  openRide,
  row,
} from '../integration/fixtures';
import { parkInputsSystem } from '../economy/park-inputs';
import { RideType } from '../rides/ride-types';
import { rideQueueSystem } from '../rides/queue-system';
import { rideSystem } from '../rides/ride-system';
import { setRideOpen } from '../rides/ride-operations';
import { TILE_UNITS } from '../core/constants';
import type { World } from '../core/world';
import { GuestState, GuestThought } from './guest-store';
import { guestSystem } from './guest-system';
import { setParkEntrance } from './park';
import {
  applyGuestBudget,
  CANT_FIND_PENALTY,
  checkCantFindExit,
  checkCantFindRide,
  checkWanderedLost,
  EXIT_RETRY_COUNTDOWN,
  LEAVING_COUNTDOWN,
  LOST_WALK_LIMIT,
  LOST_WANDER_TICKS,
  MAP_PRICE,
  RIDE_GOAL_COUNTDOWN,
  WANDER_RESET,
} from './navigation';
import {
  DEFAULT_GUEST_OPTS,
  GUEST_JUNCTIONS,
  GUEST_LEAVING_JUNCTIONS,
  GUEST_LEAVING_LOST_JUNCTIONS,
  GUEST_MAP_JUNCTIONS,
} from '../pathfinding';
import type { NavOptions } from '../pathfinding';

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    rideSystem.update(w);
    rideQueueSystem.update(w);
    guestSystem.update(w);
    w.tick++;
  }
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
  const east = 62;
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

describe('looking for a ride', () => {
  /** A guest heading for a ride, with the 200-tile search countdown running. */
  function seeker(): { w: World; slot: number } {
    const { w, slot } = trapWorld();
    const g = w.guests.cols;
    g.targetRide[slot] = w.rides.slotToId[0];
    g.lostCountdown[slot] = RIDE_GOAL_COUNTDOWN;
    g.happinessTarget[slot] = 100;
    return { w, slot };
  }

  it('starts at 200 when a guest picks a ride', () => {
    const { w, slot } = trapWorld();
    const g = w.guests.cols;
    run(w, 40);
    expect(g.targetRide[slot]).toBe(w.rides.slotToId[0]);
    expect(g.lostCountdown[slot]).toBeLessThanOrEqual(RIDE_GOAL_COUNTDOWN);
    expect(g.lostCountdown[slot]).toBeGreaterThan(RIDE_GOAL_COUNTDOWN - 10);
  });

  it("thinks it can't find the ride at 60 and 30 tiles left, losing 30 happiness each time", () => {
    const { w, slot } = seeker();
    const g = w.guests.cols;
    for (let tile = 1; tile <= 140; tile++) checkCantFindRide(w, slot);
    expect(g.lostCountdown[slot]).toBe(60);
    expect(thoughts(w, slot)).not.toContain(GuestThought.CantFindRide);
    expect(g.happinessTarget[slot]).toBe(100);

    checkCantFindRide(w, slot);
    expect(thoughts(w, slot)).toContain(GuestThought.CantFindRide);
    expect(g.happinessTarget[slot]).toBe(100 - CANT_FIND_PENALTY);

    for (let tile = 142; tile <= 170; tile++) checkCantFindRide(w, slot);
    expect(g.happinessTarget[slot]).toBe(70);
    checkCantFindRide(w, slot);
    expect(g.lostCountdown[slot]).toBe(29);
    expect(g.happinessTarget[slot]).toBe(40);
  });

  it('gives up on the ride after 200 tiles and keeps the countdown at zero', () => {
    const { w, slot } = seeker();
    const g = w.guests.cols;
    let gaveUp = 0;
    for (let tile = 1; tile <= 199; tile++) if (checkCantFindRide(w, slot)) gaveUp++;
    expect(gaveUp).toBe(0);
    expect(checkCantFindRide(w, slot)).toBe(true);
    expect(g.lostCountdown[slot]).toBe(0);
    expect(checkCantFindRide(w, slot)).toBe(false);
    expect(g.lostCountdown[slot]).toBe(0);
  });

  it('never goes below zero happiness', () => {
    const { w, slot } = seeker();
    w.guests.cols.happinessTarget[slot] = 10;
    for (let tile = 1; tile <= 200; tile++) checkCantFindRide(w, slot);
    expect(w.guests.cols.happinessTarget[slot]).toBe(0);
  });

  it('does nothing for a guest with no ride in mind', () => {
    const { w, slot } = seeker();
    const g = w.guests.cols;
    g.targetRide[slot] = -1;
    for (let tile = 1; tile <= 50; tile++) checkCantFindRide(w, slot);
    expect(g.lostCountdown[slot]).toBe(RIDE_GOAL_COUNTDOWN);
  });

  it('turns a guest who gave up on a ride into a lost wanderer', () => {
    const { w, slot } = trapWorld();
    const g = w.guests.cols;
    for (let i = 0; i < 40000 && g.lostTicks[slot] === 0; i++) run(w, 1);
    expect(g.lostTicks[slot]).toBeGreaterThan(0);
    expect(thoughts(w, slot)).toContain(GuestThought.CantFindRide);
    expect(g.state[slot]).toBe(GuestState.Wandering);
  });
});

describe('junction memory', () => {
  it('reaches a new ride behind a guest on a spur and clears the completed goal memory', () => {
    const { w, slot } = trapWorld();
    const g = w.guests.cols;
    const oldRide = w.rides.slotToId[0];
    const newRide = openRide(w, RideType.FoodStall, [2, 0], [2, 1], [1, 0]);
    const newRideId = w.rides.slotToId[newRide];
    expect(setRideOpen(w, newRideId, false)).toBe(true);

    run(w, 8_000);
    expect(g.x[slot] >> 8).toBe(4);
    expect(g.y[slot] >> 8).toBe(1);
    expect(g.navGoal[slot]).toBeGreaterThan(0);
    expect(g.pathHistory0[slot] >> 4).toBeGreaterThan(0);

    expect(setRideOpen(w, oldRide, false)).toBe(true);
    expect(setRideOpen(w, newRideId, true)).toBe(true);
    for (let tick = 0; tick < 20_000 && g.targetRide[slot] !== newRideId; tick++) run(w, 1);
    expect(g.targetRide[slot]).toBe(newRideId);
    expect(g.x[slot] >> 8).toBe(4);
    expect(g.y[slot] >> 8).toBe(1);
    for (let tick = 0; tick < 20_000 && g.state[slot] !== GuestState.Shopping; tick++) run(w, 1);

    expect(g.state[slot]).toBe(GuestState.Shopping);
    expect(g.targetRide[slot]).toBe(newRideId);
    expect(g.x[slot] >> 8).toBe(2);
    expect(g.y[slot] >> 8).toBe(1);
    expect(g.navGoal[slot]).toBe(0);
    expect(g.pathCursor[slot]).toBe(0);
    expect([
      g.pathHistory0[slot],
      g.pathHistory1[slot],
      g.pathHistory2[slot],
      g.pathHistory3[slot],
    ]).toEqual([0, 0, 0, 0]);
  });
});

describe('wandering for too long', () => {
  it('thinks it is lost after 508 tiles without a destination, then every 48 tiles', () => {
    const { w, slot } = trapWorld();
    createRideAtCorner(w, RideType.Toilets, [40, 40]);
    const g = w.guests.cols;
    g.happinessTarget[slot] = 200;
    g.targetRide[slot] = -1;
    for (let tile = 1; tile <= LOST_WALK_LIMIT - 1; tile++) checkWanderedLost(w, slot);
    expect(thoughts(w, slot)).not.toContain(GuestThought.Lost);
    checkWanderedLost(w, slot);
    expect(thoughts(w, slot)).toContain(GuestThought.Lost);
    expect(g.happinessTarget[slot]).toBe(200 - CANT_FIND_PENALTY);
    expect(g.lostTicks[slot]).toBeGreaterThan(0);
    expect(g.wanderSteps[slot]).toBe(WANDER_RESET);

    g.lostTicks[slot] = 0;
    for (let tile = 1; tile <= LOST_WALK_LIMIT - WANDER_RESET - 1; tile++)
      checkWanderedLost(w, slot);
    expect(g.happinessTarget[slot]).toBe(170);
    checkWanderedLost(w, slot);
    expect(g.happinessTarget[slot]).toBe(140);
  });

  it('counts 508 tiles as 254 steps of the lost clock reset to 230', () => {
    expect(LOST_WALK_LIMIT).toBe(508);
    expect(WANDER_RESET).toBe(460);
  });

  it('needs at least two rides in the park', () => {
    const w = flatWorld();
    layPath(w, row(5, 2, 8));
    createRideAtCorner(w, RideType.MerryGoRound, [20, 20]);
    const slot = guestAt(w, 4, 5);
    for (let tile = 1; tile <= 2000; tile++) checkWanderedLost(w, slot);
    expect(thoughts(w, slot)).not.toContain(GuestThought.Lost);
  });
});

describe('lost guests and the park rating', () => {
  it('counts a leaving guest only once its exit countdown is below 90', () => {
    const { w, slot } = trapWorld();
    const g = w.guests.cols;
    g.state[slot] = GuestState.Leaving;
    g.lostCountdown[slot] = EXIT_RETRY_COUNTDOWN;
    parkInputsSystem.update(w);
    expect(w.economy.inputs.lostGuests).toBe(0);
    g.lostCountdown[slot] = EXIT_RETRY_COUNTDOWN - 1;
    parkInputsSystem.update(w);
    expect(w.economy.inputs.lostGuests).toBe(1);
  });

  it('does not count a guest that merely gave up on a ride', () => {
    const { w, slot } = trapWorld();
    w.guests.cols.lostTicks[slot] = LOST_WANDER_TICKS;
    parkInputsSystem.update(w);
    expect(w.economy.inputs.lostGuests).toBe(0);
  });
});

describe('looking for the exit', () => {
  function leaver(): { w: World; slot: number } {
    const { w, slot } = trapWorld();
    const g = w.guests.cols;
    g.state[slot] = GuestState.Leaving;
    g.lostCountdown[slot] = LEAVING_COUNTDOWN;
    g.happinessTarget[slot] = 200;
    return { w, slot };
  }

  it("thinks it can't find the exit on the 254th tile, then again after 90 more", () => {
    const { w, slot } = leaver();
    const g = w.guests.cols;
    for (let tile = 1; tile <= 253; tile++) checkCantFindExit(w, slot);
    expect(thoughts(w, slot)).not.toContain(GuestThought.CantFindExit);
    expect(g.lostCountdown[slot]).toBe(1);
    checkCantFindExit(w, slot);
    expect(thoughts(w, slot)).toContain(GuestThought.CantFindExit);
    expect(g.happinessTarget[slot]).toBe(200 - CANT_FIND_PENALTY);
    expect(g.lostCountdown[slot]).toBe(EXIT_RETRY_COUNTDOWN);

    for (let tile = 1; tile <= 89; tile++) checkCantFindExit(w, slot);
    expect(g.happinessTarget[slot]).toBe(170);
    expect(g.lostCountdown[slot]).toBe(1);
    checkCantFindExit(w, slot);
    expect(g.happinessTarget[slot]).toBe(140);
  });

  it('only runs for a guest that is leaving', () => {
    const { w, slot } = leaver();
    w.guests.cols.state[slot] = GuestState.Wandering;
    checkCantFindExit(w, slot);
    expect(w.guests.cols.lostCountdown[slot]).toBe(LEAVING_COUNTDOWN);
  });

  it('starts the countdown at 254 when a guest decides to leave', () => {
    const w = flatWorld();
    layPath(w, row(5, 2, 12));
    const slot = guestAt(w, 8, 5);
    setParkEntrance(w, 2, 5);
    const g = w.guests.cols;
    g.energy[slot] = 0;
    g.happiness[slot] = 0;
    g.ridesTaken[slot] = 1;
    g.navGoal[slot] = 42;
    g.pathCursor[slot] = 3;
    g.pathHistory0[slot] = 17;
    g.pathHistory1[slot] = 33;
    g.pathHistory2[slot] = 49;
    g.pathHistory3[slot] = 65;
    for (let i = 0; i < 20000 && g.state[slot] !== GuestState.Leaving; i++) run(w, 1);
    expect(g.state[slot]).toBe(GuestState.Leaving);
    expect(g.lostCountdown[slot]).toBeLessThanOrEqual(LEAVING_COUNTDOWN);
    expect(g.lostCountdown[slot]).toBeGreaterThan(LEAVING_COUNTDOWN - 8);
    expect(g.navGoal[slot]).toBe(0);
    expect(g.pathCursor[slot]).toBe(0);
    expect([
      g.pathHistory0[slot],
      g.pathHistory1[slot],
      g.pathHistory2[slot],
      g.pathHistory3[slot],
    ]).toEqual([0, 0, 0, 0]);
  });
});

describe('lookahead budget', () => {
  function budget(setup: (w: World, slot: number) => void): number {
    const { w, slot } = trapWorld();
    setup(w, slot);
    const nav: NavOptions = { ...DEFAULT_GUEST_OPTS };
    applyGuestBudget(w, slot, nav);
    return nav.maxJunctions;
  }

  it('gives a guest 5 junctions, 7 with a map', () => {
    expect(budget(() => {})).toBe(GUEST_JUNCTIONS);
    expect(budget((w, slot) => (w.guests.cols.hasMap[slot] = 1))).toBe(GUEST_MAP_JUNCTIONS);
  });

  it('gives a leaving guest 7 junctions, 8 once its countdown is below 90', () => {
    const leaving =
      (countdown: number, map = 0) =>
      (w: World, slot: number) => {
        const g = w.guests.cols;
        g.state[slot] = GuestState.Leaving;
        g.lostCountdown[slot] = countdown;
        g.hasMap[slot] = map;
      };
    expect(budget(leaving(LEAVING_COUNTDOWN))).toBe(GUEST_LEAVING_JUNCTIONS);
    expect(budget(leaving(EXIT_RETRY_COUNTDOWN))).toBe(GUEST_LEAVING_JUNCTIONS);
    expect(budget(leaving(EXIT_RETRY_COUNTDOWN - 1))).toBe(GUEST_LEAVING_LOST_JUNCTIONS);
    expect(budget(leaving(LEAVING_COUNTDOWN, 1))).toBe(GUEST_LEAVING_JUNCTIONS);
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
    for (let tick = 0; tick < 20_000 && g.state[slot] !== GuestState.Shopping; tick++) run(w, 1);
    expect(g.state[slot]).toBe(GuestState.Shopping);
    g.navGoal[slot] = 42;
    g.pathCursor[slot] = 3;
    g.pathHistory0[slot] = 17;
    g.pathHistory1[slot] = 33;
    g.pathHistory2[slot] = 49;
    g.pathHistory3[slot] = 65;
    run(w, 1200);
    expect(g.hasMap[slot]).toBe(1);
    expect(g.lostTicks[slot]).toBe(0);
    expect(g.cash[slot]).toBe(cash - MAP_PRICE);
    expect(w.economy.monthlyTotals[LedgerCategory.ShopSales]).toBe(sales + MAP_PRICE);
    expect(w.rides.cols.guestsServed[kiosk]).toBe(1);
    expect(w.umbrellas[w.guests.slotToId[slot]]).toBe(0);
    expect(g.navGoal[slot]).toBe(0);
    expect(g.pathCursor[slot]).toBe(0);
    expect([
      g.pathHistory0[slot],
      g.pathHistory1[slot],
      g.pathHistory2[slot],
      g.pathHistory3[slot],
    ]).toEqual([0, 0, 0, 0]);
  });

  it('does not sell a map to a guest who is not lost', () => {
    const { w, slot } = kioskWorld();
    w.guests.cols.hunger[slot] = 0;
    run(w, 1200);
    expect(w.guests.cols.hasMap[slot]).toBe(0);
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
