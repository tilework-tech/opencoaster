import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { hashWorld } from '../core/hash';
import {
  RATING_REFRESH_TICKS,
  TICKS_PER_FORTNIGHT,
  TICKS_PER_MONTH,
  TICKS_PER_WEEK,
} from './calendar';
import { DIFFICULT_RATING_BASE, RATING_BASE } from './park-rating';
import { LedgerCategory } from './ledger';
import { setEconomyInputs } from './api';
import { RIDE_UPKEEP_DIVISOR } from './park-inputs';
import { STAFF_WAGE_CENTS_PER_WEEK } from '../staff/staff-store';
import { layPath, openRide, prepareFlat, row } from '../integration/fixtures';
import { RIDE_CATALOG, RideType } from '../rides/ride-types';
import { getRideValueCents } from '../rides/ride-operations';
import { applyEconomyAction } from './actions';
import { PriceMode } from './ledger';
import { CAMPAIGNS } from './marketing';
import { economySystem } from './economy-system';
import { recordDrowningCasualty, recordFatalRideCrash } from './api';

function sim(): Simulation {
  return new Simulation({ seed: 9, width: 16, height: 16 });
}

/** Steps through `tick` inclusive, so a boundary landing on `tick` has fired. */
function runUntil(s: Simulation, tick: number): void {
  while (s.world.tick <= tick) s.step();
}

/** A sim with an open merry-go-round, so rides publish upkeep and value. */
function simWithRide(): Simulation {
  const s = new Simulation({ seed: 9, width: 16, height: 16 });
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

describe('economy clock', () => {
  it('pays staff wages weekly and ride upkeep fortnightly', () => {
    const s = simWithRide();
    s.enqueue({ type: 'spawnStaff', count: 2, kind: 0 });
    const wages = 2 * STAFF_WAGE_CENTS_PER_WEEK[0];
    const upkeep = Math.floor(RIDE_CATALOG[RideType.MerryGoRound].cost / RIDE_UPKEEP_DIVISOR);
    const start = s.world.economy.cash;
    runUntil(s, TICKS_PER_WEEK);
    expect(s.world.economy.cash).toBe(start - wages);
    runUntil(s, TICKS_PER_FORTNIGHT);
    expect(s.world.economy.cash).toBe(start - wages * 2 - upkeep);
    expect(s.world.economy.monthlyTotals[LedgerCategory.Wages]).toBe(-wages * 2);
    expect(s.world.economy.monthlyTotals[LedgerCategory.RideRunning]).toBe(-upkeep);
  });

  it('reports the completed month and resets the running month at the boundary', () => {
    const s = sim();
    s.enqueue({ type: 'spawnStaff', count: 1, kind: 0 });
    runUntil(s, TICKS_PER_MONTH);
    const l = s.world.economy;
    expect(l.monthsCompleted).toBe(1);
    expect(l.monthlyTotals[LedgerCategory.Wages]).toBe(0);
  });

  it('decays existing casualty penalties without restoring them when a new type is recorded', () => {
    const s = sim();
    recordDrowningCasualty(s.world);
    runUntil(s, TICKS_PER_MONTH);
    expect(s.world.economy.inputs.drowningCasualtyPenalty).toBe(22);
    recordFatalRideCrash(s.world);
    expect(s.world.economy.inputs.drowningCasualtyPenalty).toBe(22);
    expect(s.world.economy.inputs.fatalRideCrashPenalty).toBe(200);
  });

  it('evaluates monthly awards using park value refreshed at that boundary', () => {
    const s = sim();
    s.world.tick = TICKS_PER_MONTH;
    s.world.economy.inputs.rideValue = 1_000_000;
    s.world.economy.parkValue = 0;

    economySystem.update(s.world);

    expect(s.world.economy.parkValue).toBe(1_000_000);
    expect(s.world.economy.activeAwards.map((award) => award.awardId)).toContain(4);
  });

  it('is deterministic for the same seed and command stream', () => {
    const cmds = [
      { tick: 0, action: { type: 'startCampaign' as const, campaignId: 1, weeks: 3 } },
      { tick: 10, action: { type: 'setPriceMode' as const, mode: PriceMode.PerRide } },
    ];
    const replay = (): number => {
      const s = sim();
      setEconomyInputs(s.world, { wageBillPerWeek: 250, rideUpkeepPerFortnight: 900 });
      for (let t = 0; t < TICKS_PER_MONTH + 1; t++) {
        for (const c of cmds) if (c.tick === t) s.enqueue({ type: 'economy', action: c.action });
        s.step();
      }
      return hashWorld(s.world);
    };
    expect(replay()).toBe(replay());
  });
});

describe('marketing campaigns', () => {
  it('charges the weekly campaign cost for its duration only, and boosts attraction while active', () => {
    const s = sim();
    const campaign = CAMPAIGNS[0];
    expect(
      applyEconomyAction(s.world.economy, { type: 'startCampaign', campaignId: 0, weeks: 2 }),
    ).toBe(true);
    const start = s.world.economy.cash;
    runUntil(s, TICKS_PER_WEEK * 3);
    expect(s.world.economy.cash).toBe(start - campaign.weeklyCostCents * 2);
    expect(s.world.economy.campaignWeeksLeft).toBe(0);
  });
});

describe('park rating and value refresh', () => {
  it('publishes park value from ride value and guests', () => {
    const s = simWithRide();
    s.enqueue({ type: 'spawnGuests', count: 3 });
    runUntil(s, 512);
    const rideValue = s.world.economy.inputs.rideValue;
    expect(getRideValueCents(s.world, s.world.rides.slotToId[0])).toBeGreaterThan(0);
    expect(rideValue).toBeGreaterThan(0);
    expect(s.world.economy.parkValue).toBe(rideValue + 3 * 700);
  });
});

describe('economy rating base', () => {
  it('uses the difficult-rating base when the scenario turns it on', () => {
    const easy = simWithRide();
    const hard = simWithRide();
    hard.world.economy.difficultRating = true;
    runUntil(easy, RATING_REFRESH_TICKS);
    runUntil(hard, RATING_REFRESH_TICKS);
    expect(easy.world.economy.parkRating - hard.world.economy.parkRating).toBe(
      RATING_BASE - DIFFICULT_RATING_BASE,
    );
  });
});
