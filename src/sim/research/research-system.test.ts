import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { TICKS_PER_WEEK } from '../economy/calendar';
import { FUNDING_WEEKLY_CENTS, Funding, isUnlocked } from './research';
import { applyResearchAction } from './research';
import { applyScenario } from '../scenario/scenario';
import type { ScenarioDef } from '../scenario/scenario';
import { ObjectiveKind } from '../scenario/scenario';
import { LedgerCategory } from '../economy/ledger';

const RIDES = 0;
const SCENERY = 1;

function scenario(): ScenarioDef {
  return {
    id: 'test',
    name: 'test',
    seed: 1,
    mapWidth: 16,
    mapHeight: 16,
    startingCash: 100_000_000,
    startingLoan: 0,
    maxLoan: 0,
    annualInterestBps: 0,
    priceMode: 0,
    admissionPrice: 0,
    availableItemIds: [100],
    inventions: [
      { itemId: 1, category: RIDES, costCents: 20_000 },
      { itemId: 2, category: SCENERY, costCents: 10_000 },
      { itemId: 3, category: RIDES, costCents: 30_000 },
    ],
    objective: { kind: ObjectiveKind.Guests, target: 0, rating: 0, categoryMask: 0, byTick: 1 },
  };
}

function weeks(s: Simulation, n: number): void {
  for (let i = 0; i <= n * TICKS_PER_WEEK; i++) s.step();
}

describe('research funding and unlocks', () => {
  it('reports scenario-available items as unlocked from the start', () => {
    const s = new Simulation({ seed: 1, width: 16, height: 16 });
    applyScenario(s.world, scenario());
    expect(isUnlocked(s.world, 100)).toBe(true);
    expect(isUnlocked(s.world, 1)).toBe(false);
  });

  it('unlocks the first eligible invention once enough funding has accumulated', () => {
    const s = new Simulation({ seed: 1, width: 16, height: 16 });
    applyScenario(s.world, scenario());
    s.enqueue({ type: 'research', action: { type: 'setFunding', level: Funding.Maximum } });
    s.enqueue({ type: 'research', action: { type: 'setCategories', mask: 1 << RIDES } });
    weeks(s, 1);
    expect(isUnlocked(s.world, 1)).toBe(false);
    weeks(s, 1);
    expect(isUnlocked(s.world, 1)).toBe(true);
    expect(isUnlocked(s.world, 2)).toBe(false);
  });

  it('still charges funding when no category is selected, but makes no progress', () => {
    const s = new Simulation({ seed: 1, width: 16, height: 16 });
    applyScenario(s.world, scenario());
    applyResearchAction(s.world.research, { type: 'setFunding', level: Funding.Normal });
    applyResearchAction(s.world.research, { type: 'setCategories', mask: 0 });
    const start = s.world.economy.cash;
    weeks(s, 10);
    expect(s.world.economy.cash).toBe(start - FUNDING_WEEKLY_CENTS[Funding.Normal] * 10);
    expect(isUnlocked(s.world, 1)).toBe(false);
    expect(isUnlocked(s.world, 2)).toBe(false);
  });

  it('does not progress at all with funding set to none', () => {
    const s = new Simulation({ seed: 1, width: 16, height: 16 });
    applyScenario(s.world, scenario());
    applyResearchAction(s.world.research, { type: 'setFunding', level: Funding.None });
    applyResearchAction(s.world.research, { type: 'setCategories', mask: 0xffffffff });
    weeks(s, 20);
    expect(isUnlocked(s.world, 2)).toBe(false);
    expect(s.world.economy.monthlyTotals[LedgerCategory.Research]).toBe(0);
  });
});
