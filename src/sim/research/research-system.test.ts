import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { TICKS_PER_MONTH, TICKS_PER_WEEK } from '../economy/calendar';
import { FUNDING_MONTHLY_CENTS, Funding, isUnlocked } from './research';
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
    averageGuestCashCents: 5_000,
    difficultRating: false,
    priceMode: 0,
    admissionPrice: 0,
    availableItemIds: [100],
    inventions: [
      { itemId: 1, category: RIDES, workUnits: 180 },
      { itemId: 2, category: SCENERY, workUnits: 90 },
      { itemId: 3, category: RIDES, workUnits: 270 },
    ],
    objective: { kind: ObjectiveKind.Guests, target: 0, rating: 0, categoryMask: 0, byTick: 1 },
  };
}

function weeks(s: Simulation, n: number): void {
  for (let i = 0; i <= n * TICKS_PER_WEEK; i++) s.step();
}

function months(s: Simulation, n: number): void {
  for (let i = 0; i <= n * TICKS_PER_MONTH; i++) s.step();
}

/** A sim with research funded at `level` and rides enabled, ready for progress checks. */
function researching(level: Funding): Simulation {
  const s = new Simulation({ seed: 1, width: 16, height: 16 });
  applyScenario(s.world, scenario());
  applyResearchAction(s.world.research, { type: 'setFunding', level });
  applyResearchAction(s.world.research, { type: 'setCategories', mask: 1 << RIDES });
  return s;
}

describe('research funding and unlocks', () => {
  it('reports scenario-available items as unlocked from the start', () => {
    const s = new Simulation({ seed: 1, width: 16, height: 16 });
    applyScenario(s.world, scenario());
    expect(isUnlocked(s.world, 100)).toBe(true);
    expect(isUnlocked(s.world, 1)).toBe(false);
  });

  it('charges funding once a month, at the level chosen', () => {
    const s = researching(Funding.Normal);
    const start = s.world.economy.cash;
    months(s, 2);
    expect(s.world.economy.cash).toBe(start - FUNDING_MONTHLY_CENTS[Funding.Normal] * 2);
    expect(s.world.economy.monthlyTotals[LedgerCategory.Research]).toBe(0);
  });

  it('takes about 60 days at minimum funding for a 60-day invention', () => {
    const s = researching(Funding.Minimum);
    weeks(s, 8);
    expect(isUnlocked(s.world, 1)).toBe(false);
    weeks(s, 1);
    expect(isUnlocked(s.world, 1)).toBe(true);
  });

  it('shortens the interval as funding rises', () => {
    const weeksToUnlock = (level: Funding): number => {
      const s = researching(level);
      for (let w = 1; w < 40; w++) {
        weeks(s, 1);
        if (isUnlocked(s.world, 1)) return w;
      }
      return -1;
    };
    const minimum = weeksToUnlock(Funding.Minimum);
    const normal = weeksToUnlock(Funding.Normal);
    const maximum = weeksToUnlock(Funding.Maximum);
    expect(maximum).toBeLessThan(normal);
    expect(normal).toBeLessThan(minimum);
  });

  it('carries leftover work into the next invention', () => {
    const s = researching(Funding.Maximum);
    weeks(s, 30);
    expect(isUnlocked(s.world, 1)).toBe(true);
    expect(isUnlocked(s.world, 2)).toBe(false);
    expect(s.world.research.progress).toBeGreaterThan(0);
  });

  it('still charges funding when no category is selected, but makes no progress', () => {
    const s = new Simulation({ seed: 1, width: 16, height: 16 });
    applyScenario(s.world, scenario());
    applyResearchAction(s.world.research, { type: 'setFunding', level: Funding.Normal });
    applyResearchAction(s.world.research, { type: 'setCategories', mask: 0 });
    const start = s.world.economy.cash;
    months(s, 10);
    expect(s.world.economy.cash).toBe(start - FUNDING_MONTHLY_CENTS[Funding.Normal] * 10);
    expect(isUnlocked(s.world, 1)).toBe(false);
    expect(isUnlocked(s.world, 2)).toBe(false);
  });

  it('does not progress at all with funding set to none', () => {
    const s = new Simulation({ seed: 1, width: 16, height: 16 });
    applyScenario(s.world, scenario());
    applyResearchAction(s.world.research, { type: 'setFunding', level: Funding.None });
    applyResearchAction(s.world.research, { type: 'setCategories', mask: 0xffffffff });
    months(s, 6);
    expect(isUnlocked(s.world, 1)).toBe(false);
    expect(s.world.economy.monthlyTotals[LedgerCategory.Research]).toBe(0);
  });
});

describe('research priorities', () => {
  it('researches a player-prioritised invention before the scenario order', () => {
    const s = researching(Funding.Maximum);
    applyResearchAction(s.world.research, { type: 'setPriority', itemIds: [3] });
    weeks(s, 8);
    expect(isUnlocked(s.world, 3)).toBe(true);
    expect(isUnlocked(s.world, 1)).toBe(false);
  });

  it('falls back to scenario order for items the player has not ranked', () => {
    const s = researching(Funding.Maximum);
    applyResearchAction(s.world.research, { type: 'setPriority', itemIds: [3] });
    weeks(s, 40);
    expect(isUnlocked(s.world, 1)).toBe(true);
  });

  it('rejects unknown, duplicate or repeated item ids and leaves the order unchanged', () => {
    const r = researching(Funding.Maximum).world.research;
    expect(applyResearchAction(r, { type: 'setPriority', itemIds: [999] })).toBe(false);
    expect(applyResearchAction(r, { type: 'setPriority', itemIds: [3, 3] })).toBe(false);
    expect(r.priority).toEqual([]);
  });

  it('accepts an empty order to return to scenario order', () => {
    const r = researching(Funding.Maximum).world.research;
    applyResearchAction(r, { type: 'setPriority', itemIds: [3] });
    expect(applyResearchAction(r, { type: 'setPriority', itemIds: [] })).toBe(true);
    expect(r.priority).toEqual([]);
  });
});
