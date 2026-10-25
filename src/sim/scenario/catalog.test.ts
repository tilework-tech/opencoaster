import { describe, expect, it } from 'vitest';
import { LedgerCategory } from '../economy/ledger';
import { IMPORTED_ID, SANDBOX_ID, ObjectiveKind } from './scenario';
import { SCENARIOS, buildCatalog, findScenario, scenarioDisplayName } from './catalog';

const minimal = (id: string) => ({
  id,
  name: id,
  seed: 1,
  map: { width: 16, height: 16 },
  finance: { startingCash: 0, startingLoan: 0, maxLoan: 0, annualInterestBps: 0 },
  pricing: { mode: 'free' },
  objective: { kind: 'guests', target: 1, byYear: 1 },
});

describe('scenario catalog', () => {
  it('ships the starter scenario as a playable definition', () => {
    const starter = findScenario('starter');
    expect(starter).toBeDefined();
    expect(SCENARIOS.map((s) => s.id)).toContain('starter');
    expect(starter?.objective.kind).toBe(ObjectiveKind.GuestsAndRating);
    expect(starter?.objective.target).toBe(100);
    expect(starter?.objective.rating).toBe(450);
    expect(starter?.entrance).toEqual({ side: 'south', length: 4 });
  });

  it('names saved games by scenario, sandbox, or imported file', () => {
    expect(scenarioDisplayName('starter')).toBe('Starter Park');
    expect(scenarioDisplayName(SANDBOX_ID)).toBe('Sandbox');
    expect(scenarioDisplayName(IMPORTED_ID)).toBe('Imported game');
    expect(scenarioDisplayName('removed-scenario')).toBe('Imported game');
  });

  it('orders scenarios by file name so the title screen list is stable', () => {
    const catalog = buildCatalog({
      './scenarios/b.json': minimal('b'),
      './scenarios/a.json': minimal('a'),
    });
    expect(catalog.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('lists the starter scenario first whatever the file names sort to', () => {
    const catalog = buildCatalog({
      './scenarios/a.json': minimal('a'),
      './scenarios/starter.json': minimal('starter'),
      './scenarios/z.json': minimal('z'),
    });
    expect(catalog.map((s) => s.id)).toEqual(['starter', 'a', 'z']);
    expect(SCENARIOS[0].id).toBe('starter');
  });

  it('rejects two files that declare the same scenario id', () => {
    expect(() =>
      buildCatalog({ './scenarios/a.json': minimal('dup'), './scenarios/b.json': minimal('dup') }),
    ).toThrow(/Duplicate scenario id dup/);
  });

  it('fails the whole catalog when one scenario file is malformed', () => {
    expect(() => buildCatalog({ './scenarios/bad.json': { id: 'bad' } })).toThrow(/Scenario bad/);
  });

  describe('shipped scenarios', () => {
    const added = SCENARIOS.filter((s) => s.id !== 'starter');

    it('offers at least eight more parks, each with its own generated map', () => {
      expect(added.length).toBeGreaterThanOrEqual(8);
      for (const s of added) {
        expect(s.terrain, s.id).toBeDefined();
        expect(s.entrance, s.id).toBeDefined();
      }
      const recipes = new Set(
        added.map((s) => JSON.stringify([s.terrain, s.land, s.seed, s.mapWidth])),
      );
      expect(recipes.size).toBe(added.length);
    });

    it('fills the beginner, challenging, expert and real tabs', () => {
      for (const tab of ['beginner', 'challenging', 'expert', 'real'] as const) {
        expect(SCENARIOS.filter((s) => s.category === tab).length, tab).toBeGreaterThanOrEqual(1);
      }
    });

    it('covers every objective family the genre uses', () => {
      const kinds = new Set(SCENARIOS.map((s) => s.objective.kind));
      for (const kind of [
        ObjectiveKind.Guests,
        ObjectiveKind.ParkValue,
        ObjectiveKind.HaveFun,
        ObjectiveKind.CompleteCoasters,
        ObjectiveKind.RepayLoanAndParkValue,
        ObjectiveKind.GuestsAndRating,
      ]) {
        expect(kinds.has(kind), ObjectiveKind[kind]).toBe(true);
      }
      const income = SCENARIOS.filter((s) => s.objective.kind === ObjectiveKind.MonthlyIncome);
      const masks = income.map((s) => s.objective.categoryMask);
      expect(masks).toContain(1 << LedgerCategory.RideTickets);
      expect(masks).toContain(
        (1 << LedgerCategory.FoodDrinkSales) | (1 << LedgerCategory.FoodDrinkStock),
      );
    });

    it('gives every park original names and finances the player can start from', () => {
      const names = new Set(SCENARIOS.map((s) => s.name));
      expect(names.size).toBe(SCENARIOS.length);
      for (const s of added) {
        expect(s.startingLoan, s.id).toBeLessThanOrEqual(s.maxLoan);
        expect(s.startingCash, s.id).toBeGreaterThan(0);
        expect(s.availableItemIds.length, s.id).toBeGreaterThan(0);
      }
    });
  });
});
