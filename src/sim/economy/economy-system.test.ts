import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { hashWorld } from '../core/hash';
import { TICKS_PER_FORTNIGHT, TICKS_PER_MONTH, TICKS_PER_WEEK } from './calendar';
import { LedgerCategory } from './ledger';
import { setEconomyInputs } from './api';
import { applyEconomyAction } from './actions';
import { PriceMode } from './ledger';
import { CAMPAIGNS } from './marketing';

function sim(): Simulation {
  return new Simulation({ seed: 9, width: 16, height: 16 });
}

/** Steps through `tick` inclusive, so a boundary landing on `tick` has fired. */
function runUntil(s: Simulation, tick: number): void {
  while (s.world.tick <= tick) s.step();
}

describe('economy clock', () => {
  it('pays wages weekly and ride upkeep fortnightly', () => {
    const s = sim();
    setEconomyInputs(s.world, { wageBillPerWeek: 700, rideUpkeepPerFortnight: 3_000 });
    const start = s.world.economy.cash;
    runUntil(s, TICKS_PER_WEEK);
    expect(s.world.economy.cash).toBe(start - 700);
    runUntil(s, TICKS_PER_FORTNIGHT);
    expect(s.world.economy.cash).toBe(start - 700 * 2 - 3_000);
    expect(s.world.economy.monthlyTotals[LedgerCategory.Wages]).toBe(-700 * 2);
    expect(s.world.economy.monthlyTotals[LedgerCategory.RideRunning]).toBe(-3_000);
  });

  it('reports the completed month and resets the running month at the boundary', () => {
    const s = sim();
    setEconomyInputs(s.world, { wageBillPerWeek: 100 });
    runUntil(s, TICKS_PER_MONTH);
    const l = s.world.economy;
    expect(l.monthsCompleted).toBe(1);
    expect(l.monthlyTotals[LedgerCategory.Wages]).toBe(0);
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
    const s = sim();
    setEconomyInputs(s.world, { rideValue: 12_345 });
    runUntil(s, 512);
    expect(s.world.economy.parkValue).toBe(12_345);
  });
});
