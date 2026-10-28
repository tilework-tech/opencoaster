import { describe, expect, it } from 'vitest';
import { createBalancePark } from './balance-park';
import { TICKS_PER_MONTH } from '../src/sim/economy/calendar';
import { GENERATION_ROLL_RANGE } from '../src/sim/economy/guest-generation';
import { parkRatingBreakdown, RATING_BASE } from '../src/sim/economy/park-rating';

const MONTHS = 6;
const LONG_RUN_TIMEOUT_MS = 60_000;

interface MonthEnd {
  rating: number;
  guests: number;
  suggestedMax: number;
}

/** Runs the scripted starter park, counting guest spawns and summing the arrival odds each tick. */
function trajectory() {
  const park = createBalancePark();
  const world = park.sim.world;
  let arrived = 0;
  let expected = 0;
  const spawn = world.guests.spawn.bind(world.guests);
  world.guests.spawn = () => {
    const slot = spawn();
    if (slot >= 0) arrived++;
    return slot;
  };
  const months: MonthEnd[] = [];
  for (let t = 1; t <= MONTHS * TICKS_PER_MONTH; t++) {
    park.runSchedule();
    expected += world.economy.guestGeneration.probability / GENERATION_ROLL_RANGE;
    park.sim.step();
    if (world.tick % TICKS_PER_MONTH === 0) {
      months.push({
        rating: world.economy.parkRating,
        guests: world.guests.count,
        suggestedMax: world.economy.guestGeneration.suggestedGuestMax,
      });
    }
  }
  return { world, months, arrived, expected };
}

/**
 * RCT2's arrival model draws a guest each tick with probability (50 + rating above 200, at most
 * 650) / 65536, quartered once the park is over its suggested maximum. A park of the starter
 * scenario's size should therefore ramp to roughly its suggested maximum and stay there, with
 * the rating held up by the ride mix rather than pinned at either end.
 */
describe('reference park trajectory over six months', () => {
  const run = trajectory();

  it(
    'admits guests at the rate the generation probability implies',
    () => {
      const sigma = Math.sqrt(run.expected);
      expect(run.expected).toBeGreaterThan(100);
      expect(Math.abs(run.arrived - run.expected)).toBeLessThan(3 * sigma);
    },
    LONG_RUN_TIMEOUT_MS,
  );

  it('keeps the month-end rating inside the band the RCT2 factors allow', () => {
    // Opening months: the rating is dragged by few rides; later it settles under the 999 cap.
    for (const [index, m] of run.months.entries()) {
      expect(m.rating, `month ${index + 1}`).toBeGreaterThanOrEqual(500);
      expect(m.rating, `month ${index + 1}`).toBeLessThan(950);
    }
    expect(run.months[2].rating).toBeGreaterThan(run.months[0].rating);
  });

  it('grows the crowd to about the suggested maximum and holds it there', () => {
    const [m1, m2, m3, m4, m5, m6] = run.months;
    expect(m2.guests).toBeGreaterThan(m1.guests);
    expect(m3.guests).toBeGreaterThan(m2.guests);
    for (const m of [m4, m5, m6]) {
      expect(m.guests).toBeGreaterThan(0.6 * m.suggestedMax);
      expect(m.guests).toBeLessThan(1.4 * m.suggestedMax);
    }
  });

  it('computes the final rating from the RCT2 factors of the published inputs', () => {
    const l = run.world.economy;
    const factors = parkRatingBreakdown(run.world.guests.count, l.inputs, RATING_BASE);
    const names = Object.keys(factors).filter((k) => k !== 'raw' && k !== 'total' && k !== 'base');
    expect(names.reduce((sum, k) => sum + factors[k as keyof typeof factors], factors.base)).toBe(
      factors.raw,
    );
    expect(Math.abs(l.parkRating - factors.total)).toBeLessThan(250);
  });
});
