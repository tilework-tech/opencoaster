import { describe, expect, it } from 'vitest';
import { createBalancePark } from './balance-park';
import { hashWorld } from '../src/sim/core/hash';
import { Simulation } from '../src/sim/core/simulation';
import { TICKS_PER_MONTH } from '../src/sim/economy/calendar';
import { MAX_RATING } from '../src/sim/economy/park-rating';
import { RideType } from '../src/sim/rides/ride-types';
import { deserialize, serialize } from '../src/save/save';
import { ScenarioStatus } from '../src/sim/scenario/scenario';
import { isReachable } from '../src/sim/pathfinding/navigate';
import { LedgerCategory, PriceMode, completedMonthTotal } from '../src/sim/economy/ledger';

function run(ticks: number, seed?: number) {
  const park = createBalancePark({ seed });
  for (let t = 0; t < ticks; t++) {
    park.runSchedule();
    park.sim.step();
  }
  return park.sim;
}

const FOUR_MONTHS = TICKS_PER_MONTH * 4;
const FULL_YEAR = TICKS_PER_MONTH * 8;
/** Multi-month sim runs take 1.5–6 s locally and more on shared CI runners; 5 s is too tight. */
const LONG_RUN_TIMEOUT_MS = 30_000;
describe('sensible starter park balance', () => {
  it(
    'breaks even by month two and earns profit by month four with the target starter park',
    () => {
      const park = createBalancePark({ profile: 'sensible' });
      const monthlyNet: number[] = [];
      for (let tick = 0; tick < TICKS_PER_MONTH * 4; tick++) {
        park.runSchedule();
        park.sim.step();
        if (park.sim.world.economy.monthsCompleted > monthlyNet.length) {
          monthlyNet.push(
            Array.from({ length: LedgerCategory.COUNT }, (_, category) =>
              completedMonthTotal(park.sim.world.economy, category),
            ).reduce((total, value) => total + value, 0),
          );
        }
      }
      const w = park.sim.world;
      expect(w.staff.count).toBe(3);
      expect(
        Array.from({ length: w.staff.count }, (_, slot) => w.staff.cols.kind[slot]).sort(),
      ).toEqual([0, 0, 1]);
      expect(w.rides.count).toBe(7);
      expect(w.scenario.objective?.target).toBe(360);
      expect(w.economy.priceMode).toBe(PriceMode.PerRide);
      expect(w.economy.admissionPrice).toBe(0);
      expect(monthlyNet[1]).toBeGreaterThanOrEqual(0);
      expect(monthlyNet[3]).toBeGreaterThan(10_000);
      expect(monthlyNet).toHaveLength(4);
    },
    LONG_RUN_TIMEOUT_MS,
  );
});

describe('scripted starter park', () => {
  const sim = run(FOUR_MONTHS);
  const w = sim.world;

  it('holds a lively crowd without the rating pinned at either end', () => {
    expect(w.guests.count).toBeGreaterThan(40);
    expect(w.economy.parkRating).toBeGreaterThanOrEqual(200);
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

  it(
    'is deterministic for a seed',
    () => {
      expect(hashWorld(run(FOUR_MONTHS).world)).toBe(hashWorld(w));
      expect(hashWorld(run(TICKS_PER_MONTH, 99).world)).not.toBe(
        hashWorld(run(TICKS_PER_MONTH, 100).world),
      );
    },
    LONG_RUN_TIMEOUT_MS,
  );

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

  it('connects the coaster exit to the park entrance for mechanic access', () => {
    const park = createBalancePark();
    const targetTick = TICKS_PER_MONTH * 2 + 1;
    while (park.sim.world.tick < targetTick) {
      park.runSchedule();
      park.sim.step();
    }
    const world = park.sim.world;
    const coaster = Array.from({ length: world.rides.count }, (_, slot) => slot).find(
      (slot) => world.rides.cols.typeId[slot] === RideType.WoodenCoaster,
    );
    expect(coaster, 'the coaster is built by the third construction wave').toBeDefined();
    const exitX = world.rides.cols.exitX[coaster!];
    const exitY = world.rides.cols.exitY[coaster!];
    const entrance = world.map.index(world.park.entranceX, world.park.entranceY);
    const beside = [
      [exitX + 1, exitY],
      [exitX - 1, exitY],
      [exitX, exitY + 1],
      [exitX, exitY - 1],
    ].map(([x, y]) => world.map.index(x, y));
    expect(beside.some((tile) => isReachable(world, entrance, tile))).toBe(true);
  });

  it(
    'can meet the starter scenario objective by the year-end check',
    () => {
      expect(run(FULL_YEAR).world.scenario.status).toBe(ScenarioStatus.Won);
    },
    LONG_RUN_TIMEOUT_MS,
  );
});
