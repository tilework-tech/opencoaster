import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { hashWorld } from '../core/hash';
import { TICKS_PER_MONTH } from '../economy/calendar';
import { LedgerCategory, PriceMode, completedMonthTotal } from '../economy/ledger';
import { Surface } from '../map/tile-map';
import { RideType } from '../rides/ride-types';
import { RidePhase } from '../rides/ride-store';
import {
  connectRideQueue,
  getRideGuestsServed,
  placeRideEntranceExit,
  setRideOpen,
  setRidePrice,
} from '../rides/ride-operations';
import { deserialize, serialize } from '../../save/save';

const TICKS_PER_DAY = Math.floor(TICKS_PER_MONTH / 31);

/**
 * 32x32 flat park. A 9x7 footpath loop with a one-tile stub to the gate, a merry-go-round whose
 * queue enters the loop from inside, and a food stall on the loop's west side.
 */
function buildPark(seed = 7): Simulation {
  const sim = new Simulation({ seed, width: 32, height: 32 });
  const m = sim.world.map;
  m.waterLevel.fill(0);
  m.ownership.fill(1);
  m.fillFlat(4);

  const path = (x: number, y: number, queue = false): void =>
    sim.enqueue({ type: 'placePath', x, y, queue });
  for (let x = 8; x <= 16; x++) {
    path(x, 8);
    path(x, 14);
  }
  for (let y = 9; y <= 13; y++) {
    path(8, y);
    path(16, y);
  }
  path(12, 15);
  path(12, 16);
  path(14, 12, true);
  path(14, 13, true);
  path(15, 11);
  sim.enqueue({ type: 'setParkEntrance', x: 12, y: 16 });
  sim.enqueue({ type: 'createRide', rideType: RideType.MerryGoRound, x: 14, y: 11 });
  sim.enqueue({ type: 'createRide', rideType: RideType.FoodStall, x: 9, y: 10 });
  sim.enqueue({ type: 'economy', action: { type: 'setPriceMode', mode: PriceMode.PerRide } });
  sim.step();

  const w = sim.world;
  const [ride, stall] = [w.rides.slotToId[0], w.rides.slotToId[1]];
  expect(placeRideEntranceExit(w, ride, { x: 14, y: 12 }, { x: 15, y: 11 })).toBe(true);
  expect(
    connectRideQueue(w, ride, [
      { x: 14, y: 12 },
      { x: 14, y: 13 },
      { x: 14, y: 14 },
    ]),
  ).toBe(true);
  expect(setRidePrice(w, ride, 200)).toBe(true);
  expect(setRideOpen(w, ride, true)).toBe(true);
  expect(placeRideEntranceExit(w, stall, { x: 8, y: 10 }, { x: 9, y: 11 })).toBe(true);
  expect(setRideOpen(w, stall, true)).toBe(true);
  return sim;
}

function runDays(sim: Simulation, days: number): void {
  for (let i = 0; i < days * TICKS_PER_DAY; i++) sim.step();
}

describe('small park integration', () => {
  it('builds with every piece accepted', () => {
    const sim = buildPark();
    const m = sim.world.map;
    expect(m.surface[m.index(14, 12)]).toBe(Surface.Queue);
    expect(m.surface[m.index(12, 16)]).toBe(Surface.Path);
    expect(sim.world.rides.count).toBe(2);
  });

  it('admits guests who ride, shop, and move money through the ledger', () => {
    const sim = buildPark();
    const w = sim.world;
    const cashBefore = w.economy.cash;
    runDays(sim, 40);

    const rideId = w.rides.slotToId[0];
    expect(getRideGuestsServed(w, rideId)).toBeGreaterThan(5);
    expect(w.rides.cols.cyclesCompleted[0]).toBeGreaterThan(2);

    const months = Math.max(1, w.economy.monthsCompleted);
    let tickets = w.economy.monthlyTotals[LedgerCategory.RideTickets];
    let food = w.economy.monthlyTotals[LedgerCategory.FoodDrinkSales];
    for (let i = 0; i < months; i++) {
      tickets += completedMonthTotal(w.economy, LedgerCategory.RideTickets, i);
      food += completedMonthTotal(w.economy, LedgerCategory.FoodDrinkSales, i);
    }
    expect(tickets).toBeGreaterThan(0);
    expect(food).toBeGreaterThan(0);
    expect(w.economy.cash).not.toBe(cashBefore);
    expect(w.guests.count).toBeGreaterThan(0);
    expect(w.economy.parkRating).toBeGreaterThan(100);
    expect(w.economy.parkRating).toBeLessThanOrEqual(999);
    expect(w.economy.inputs.rideValue).toBeGreaterThan(0);
  });

  it('keeps every guest on the footpath network or inside a ride', () => {
    const sim = buildPark();
    const w = sim.world;
    const m = w.map;
    for (let t = 0; t < 12 * TICKS_PER_DAY; t++) {
      sim.step();
      if (t % 97 !== 0) continue;
      for (let s = 0; s < w.guests.count; s++) {
        if (w.guests.cols.state[s] === 2) continue;
        const tile = m.index((w.guests.cols.x[s] / 256) | 0, (w.guests.cols.y[s] / 256) | 0);
        expect(m.isWalkable(tile)).toBe(true);
      }
    }
    expect(w.guests.count).toBeGreaterThan(0);
  });

  it('is deterministic and survives a save/load round trip mid-run', () => {
    const a = buildPark(11);
    const b = buildPark(11);
    runDays(a, 15);
    runDays(b, 15);
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));

    const loaded = new Simulation({ seed: 11, width: 32, height: 32 });
    Object.assign(loaded, { world: deserialize(serialize(a.world)) });
    runDays(a, 10);
    runDays(loaded, 10);
    expect(hashWorld(loaded.world)).toBe(hashWorld(a.world));
  });

  it('leaves rides idle without a gate', () => {
    const sim = buildPark();
    sim.world.park.entranceX = -1;
    sim.world.park.entranceY = -1;
    runDays(sim, 10);
    expect(sim.world.guests.count).toBe(0);
    expect(sim.world.rides.cols.phase[0]).toBe(RidePhase.Waiting);
  });
});
