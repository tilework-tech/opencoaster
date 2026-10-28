import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { layPath, openRide, prepareFlat, row } from '../integration/fixtures';
import { setRideOpen } from '../rides/ride-operations';
import { RIDE_CATALOG, RideType } from '../rides/ride-types';
import { INPUT_REFRESH_TICKS } from './park-inputs';
import { STAFF_WAGE_CENTS_PER_WEEK } from '../staff/staff-store';
import { completeCycle } from '../rides/ride-system';
import { parkInputsSystem } from './park-inputs';
import { rideSystem } from '../rides/ride-system';

function park(): Simulation {
  const s = new Simulation({ seed: 2, width: 16, height: 16 });
  prepareFlat(s.world);
  layPath(s.world, row(5, 2, 9));
  layPath(s.world, row(5, 10, 11), true);
  layPath(s.world, [[12, 4]]);
  openRide(
    s.world,
    RideType.MerryGoRound,
    [11, 4],
    [11, 5],
    [12, 4],
    [
      [10, 5],
      [9, 5],
    ],
  );
  return s;
}

function refresh(s: Simulation): void {
  const until = s.world.tick + INPUT_REFRESH_TICKS + 1;
  while (s.world.tick < until) s.step();
}

describe('economy inputs from the park', () => {
  it('keeps role-specific wages after the regular park input refresh', () => {
    const s = park();
    s.enqueue({ type: 'hireStaff', kind: 1 });
    s.enqueue({ type: 'hireStaff', kind: 2 });
    s.step();

    refresh(s);

    expect(s.world.economy.inputs.wageBillPerWeek).toBe(
      STAFF_WAGE_CENTS_PER_WEEK[1] + STAFF_WAGE_CENTS_PER_WEEK[2],
    );
  });

  it('reports running cost and qualifying rides for open rides while retaining closed ride value', () => {
    const s = park();
    refresh(s);
    const inputs = s.world.economy.inputs;
    expect(inputs.rideUpkeepPerFortnight).toBe(
      RIDE_CATALOG[RideType.MerryGoRound].runningCostPerFortnightCents,
    );
    expect(inputs.rideValue).toBeGreaterThan(0);
    expect(inputs.qualifyingRideCount).toBe(1);

    setRideOpen(s.world, s.world.rides.slotToId[0], false);
    refresh(s);
    expect(s.world.economy.inputs.rideUpkeepPerFortnight).toBe(0);
    expect(s.world.economy.inputs.rideValue).toBeGreaterThan(0);
    expect(s.world.economy.inputs.qualifyingRideCount).toBe(0);
  });

  it('counts completed riders in the five-minute park-value window, then ages them out', () => {
    const s = park();
    for (let i = 0; i < 12; i++) completeCycle(s.world, 0, 1);
    parkInputsSystem.update(s.world);
    const withRecentRiders = s.world.economy.inputs.rideValue;
    expect(withRecentRiders).toBeGreaterThan(0);

    s.world.tick = 60 * 200;
    rideSystem.update(s.world);
    s.world.tick += 160;
    rideSystem.update(s.world);
    parkInputsSystem.update(s.world);
    expect(s.world.economy.inputs.rideValue).toBeLessThan(withRecentRiders);
  });

  it('reports the share of unhappy guests and the guests who are off the paths', () => {
    const s = park();
    s.enqueue({ type: 'setParkEntrance', x: 2, y: 5 });
    s.enqueue({ type: 'spawnGuests', count: 4 });
    s.step();
    const g = s.world.guests.cols;
    for (let i = 0; i < 4; i++) g.happiness[i] = i < 3 ? 40 : 250;
    g.x[3] = 14 * 256 + 128;
    g.y[3] = 14 * 256 + 128;
    s.world.tick = INPUT_REFRESH_TICKS;
    parkInputsSystem.update(s.world);
    expect(s.world.economy.inputs.unhappyPercent).toBe(75);
    expect(s.world.economy.inputs.lostGuests).toBe(1);
  });

  it('lowers the park rating when guests are unhappy', () => {
    const rate = (happiness: number): number => {
      const s = park();
      s.enqueue({ type: 'setParkEntrance', x: 2, y: 5 });
      s.enqueue({ type: 'spawnGuests', count: 10 });
      s.step();
      s.world.guests.cols.happiness.fill(happiness, 0, 10);
      while (s.world.tick < 513) {
        s.world.guests.cols.happiness.fill(happiness, 0, 10);
        s.step();
      }
      return s.world.economy.parkRating;
    };
    expect(rate(250)).toBeGreaterThan(rate(20));
  });

  it('totals the excitement and intensity of open attractions only', () => {
    const s = park();
    const slot = 0;
    s.world.rides.cols.excitement[slot] = 360;
    s.world.rides.cols.intensity[slot] = 120;
    refresh(s);

    const inputs = s.world.economy.inputs;
    expect(inputs.openAttractionCount).toBe(1);
    expect(inputs.excitementTotal).toBe(360);
    expect(inputs.intensityTotal).toBe(120);

    setRideOpen(s.world, s.world.rides.slotToId[slot], false);
    refresh(s);
    expect(s.world.economy.inputs.openAttractionCount).toBe(0);
    expect(s.world.economy.inputs.excitementTotal).toBe(0);
  });
});
