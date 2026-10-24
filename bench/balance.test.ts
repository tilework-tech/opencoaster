import { describe, expect, it } from 'vitest';
import { createBalancePark } from './balance-park';
import { hashWorld } from '../src/sim/core/hash';
import { Simulation } from '../src/sim/core/simulation';
import { TICKS_PER_MONTH } from '../src/sim/economy/calendar';
import { MAX_RATING } from '../src/sim/economy/park-rating';
import { RideType } from '../src/sim/rides/ride-types';
import { deserialize, serialize } from '../src/save/save';

function run(ticks: number, seed?: number) {
  const park = createBalancePark({ seed });
  for (let t = 0; t < ticks; t++) {
    park.runSchedule();
    park.sim.step();
  }
  return park.sim;
}

const FOUR_MONTHS = TICKS_PER_MONTH * 4;

describe('scripted starter park', () => {
  const sim = run(FOUR_MONTHS);
  const w = sim.world;

  it('holds a lively crowd without the rating pinned at either end', () => {
    expect(w.guests.count).toBeGreaterThan(40);
    expect(w.economy.parkRating).toBeGreaterThan(300);
    expect(w.economy.parkRating).toBeLessThan(MAX_RATING);
  });

  it('keeps every shop and attraction near the gate in use, including the coaster', () => {
    const served = new Map<number, number>();
    for (let slot = 0; slot < w.rides.count; slot++) {
      const type = w.rides.cols.typeId[slot];
      served.set(type, (served.get(type) ?? 0) + w.rides.cols.guestsServed[slot]);
    }
    for (const type of [
      RideType.MerryGoRound,
      RideType.FerrisWheel,
      RideType.FoodStall,
      RideType.DrinkStall,
      RideType.Toilets,
      RideType.InformationKiosk,
      RideType.WoodenCoaster,
    ]) {
      expect(served.get(type) ?? 0, `ride type ${type}`).toBeGreaterThan(0);
    }
  });

  it('is deterministic for a seed', () => {
    expect(hashWorld(run(FOUR_MONTHS).world)).toBe(hashWorld(w));
    expect(hashWorld(run(TICKS_PER_MONTH, 99).world)).not.toBe(
      hashWorld(run(TICKS_PER_MONTH, 100).world),
    );
  });

  it('continues identically after a save and load', () => {
    const park = createBalancePark();
    for (let t = 0; t < TICKS_PER_MONTH; t++) {
      park.runSchedule();
      park.sim.step();
    }
    const loaded = new Simulation(deserialize(serialize(park.sim.world)));
    for (let t = 0; t < 4000; t++) {
      park.sim.step();
      loaded.step();
    }
    expect(hashWorld(loaded.world)).toBe(hashWorld(park.sim.world));
  });
});
