import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { TICKS_PER_MONTH } from './calendar';
import { createSnapshot, writeSnapshot } from '../../worker/snapshot';
import { deserialize, serialize } from '../../save/save';
import { AWARDS, AWARD_DURATION_MONTHS, evaluateMonthlyAward } from './awards';
import { guestGenerationProbability } from './guest-generation';
import { spawnGuest } from '../guests/guest-store';
import { GuestState } from '../guests/guest-store';
import { RideState } from '../rides/ride-store';
import { RideType } from '../rides/ride-types';

function advanceTo(s: Simulation, tick: number): void {
  while (s.world.tick < tick) s.step();
}

function news(sim: Simulation): Array<{ tick: number; text: string }> {
  const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 128 });
  writeSnapshot(sim.world, snapshot);
  return snapshot.parkNews;
}

describe('monthly park awards', () => {
  it('announces an eligible award at a month start and publishes it in the snapshot', () => {
    const sim = new Simulation({ seed: 11, width: 16, height: 16 });
    const debris = sim.world.litter;
    for (let i = 0; i < 100; i++) debris.spawn();

    advanceTo(sim, TICKS_PER_MONTH);
    expect(news(sim)).toHaveLength(0);
    sim.step();
    expect(news(sim).length).toBeGreaterThan(0);
    expect(news(sim)).toHaveLength(1);
    expect(news(sim)[0].text).toBe('Your park has received the Most Disappointing Park award.');
    expect(news(sim)[0].tick).toBe(TICKS_PER_MONTH);
  });

  it('announces at most one new award at each month start', () => {
    const sim = new Simulation({ seed: 13, width: 16, height: 16 });
    for (let i = 0; i < 100; i++) sim.world.litter.spawn();

    advanceTo(sim, 3 * TICKS_PER_MONTH + 1);

    const announcements = news(sim);
    for (let month = 1; month <= 3; month++) {
      expect(
        announcements.filter((item) => item.tick === month * TICKS_PER_MONTH).length,
      ).toBeLessThanOrEqual(1);
    }
    expect(announcements.length).toBeLessThanOrEqual(3);
    expect(
      announcements.every(
        (item, index) => index === 0 || item.tick > announcements[index - 1].tick,
      ),
    ).toBe(true);
  });

  it('preserves active awards and their news when a saved game is loaded', () => {
    const sim = new Simulation({ seed: 12, width: 16, height: 16 });
    for (let i = 0; i < 100; i++) sim.world.litter.spawn();
    advanceTo(sim, TICKS_PER_MONTH + 1);

    const restored = deserialize(serialize(sim.world));
    expect(news(sim).length).toBeGreaterThan(0);
    expect(news(sim)).toEqual(news(new Simulation(restored)));
    expect(sim.world.economy.activeAwards).toEqual(restored.economy.activeAwards);
    expect(restored.economy.guestGeneration).toEqual(sim.world.economy.guestGeneration);
  });

  it('registers the documented award catalog and expires its attraction effect', () => {
    expect(AWARDS.map((award) => award.name)).toEqual([
      'Best Custom-Designed Rides',
      'Best Gentle Rides',
      'Best Park Food',
      'Best Park Toilets',
      'Best Park Value',
      'Best Roller Coasters',
      'Best Staff',
      'Best Water Rides',
      'Most Beautiful Park',
      'Most Dazzling Ride Color Schemes',
      'Safest Park',
      'Tidiest Park',
      'Most Confusing Park Layout',
      'Most Disappointing Park',
      'Untidiest Park',
      'Worst Park Food',
      'Worst Park Value',
    ]);
    const sim = new Simulation({ seed: 14, width: 16, height: 16 });
    sim.world.economy.activeAwards.push({
      awardId: 0,
      expiresTick: AWARD_DURATION_MONTHS * TICKS_PER_MONTH,
    });
    const probabilityAt = (tick: number, awards = sim.world.economy.activeAwards) =>
      guestGenerationProbability({
        parkRating: 850,
        guests: 0,
        suggestedGuestMax: 1000,
        entranceFeeCents: 0,
        rideValueForMoney: 0,
        awards,
        tick,
      });
    expect(probabilityAt(0)).toBe(712);
    expect(probabilityAt(AWARD_DURATION_MONTHS * TICKS_PER_MONTH)).toBe(700);
    expect(probabilityAt(0, [{ awardId: 13, expiresTick: 100_000 }])).toBe(525);
  });

  it('judges park food awards from hunger satiation', () => {
    const satisfied = new Simulation({ seed: 15, width: 16, height: 16 });
    const hungry = new Simulation({ seed: 15, width: 16, height: 16 });
    const setup = (sim: Simulation, satiation: number) => {
      sim.world.economy.parkRating = 700;
      sim.world.economy.inputs.litter = 10;
      for (let i = 0; i < 4; i++) {
        spawnGuest(sim.world);
        const slot = sim.world.guests.count - 1;
        sim.world.guests.cols.hunger[slot] = satiation;
        sim.world.guests.cols.state[slot] = GuestState.Riding;
      }
      for (let i = 0; i < 3; i++) {
        const slot = sim.world.rides.spawn();
        sim.world.rides.cols.typeId[slot] = RideType.FoodStall;
        sim.world.rides.cols.state[slot] = RideState.Open;
      }
      evaluateMonthlyAward(sim.world, TICKS_PER_MONTH);
    };
    setup(satisfied, 255);
    setup(hungry, 0);

    expect(satisfied.world.economy.activeAwards[0]?.awardId).toBe(2);
    expect(hungry.world.economy.activeAwards.some((award) => award.awardId === 2)).toBe(false);
  });
});
