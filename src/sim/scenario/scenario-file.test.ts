import { describe, expect, it } from 'vitest';
import { TICKS_PER_YEAR } from '../economy/calendar';
import { LedgerCategory } from '../economy/ledger';
import { Climate } from '../weather/weather';
import { ObjectiveKind } from './scenario';
import { parseScenarioFile } from './scenario-file';

const valid = {
  id: 'test-park',
  name: 'Test Park',
  description: 'A park for tests.',
  seed: 7,
  map: { width: 48, height: 40 },
  finance: {
    startingCash: 5_000_000,
    startingLoan: 1_000_000,
    maxLoan: 10_000_000,
    annualInterestBps: 1000,
  },
  pricing: { mode: 'admission', admissionPrice: 300 },
  research: {
    availableItemIds: [1, 2],
    inventions: [{ itemId: 3, category: 0, workUnits: 9_000 }],
  },
  entrance: { side: 'south', length: 4 },
  objective: { kind: 'guestsAndRating', target: 150, rating: 600, byYear: 1 },
};

function withObjective(objective: Record<string, unknown>): unknown {
  return { ...valid, objective };
}

describe('parseScenarioFile', () => {
  it('converts a JSON scenario into a scenario definition', () => {
    const def = parseScenarioFile(valid);
    expect(def).toEqual({
      id: 'test-park',
      name: 'Test Park',
      category: 'beginner',
      description: 'A park for tests.',
      seed: 7,
      mapWidth: 48,
      mapHeight: 40,
      startingCash: 5_000_000,
      startingLoan: 1_000_000,
      maxLoan: 10_000_000,
      annualInterestBps: 1000,
      priceMode: 1,
      admissionPrice: 300,
      difficultRating: false,
      availableItemIds: [1, 2],
      inventions: [{ itemId: 3, category: 0, workUnits: 9_000 }],
      entrance: { side: 'south', length: 4 },
      objective: {
        kind: ObjectiveKind.GuestsAndRating,
        target: 150,
        rating: 600,
        categoryMask: 0,
        byTick: TICKS_PER_YEAR,
        minimumExcitement: 0,
        minimumLength: 0,
        minimumRating: 0,
      },
    });
  });

  it('parses the four supported climates and rejects an unknown climate', () => {
    expect(parseScenarioFile({ ...valid, climate: 'coolAndWet' }).climate).toBe(Climate.CoolAndWet);
    expect(() => parseScenarioFile({ ...valid, climate: 'tropical' })).toThrow(/climate/);
  });

  it('accepts the difficulty category used by scenario selection', () => {
    expect(parseScenarioFile({ ...valid, category: 'expert' }).category).toBe('expert');
    expect(() => parseScenarioFile({ ...valid, category: 'impossible' })).toThrow(/category/);
  });

  it('defaults difficultRating to off and accepts it as a boolean', () => {
    expect(parseScenarioFile(valid).difficultRating).toBe(false);
    expect(parseScenarioFile({ ...valid, difficultRating: true }).difficultRating).toBe(true);
    expect(() => parseScenarioFile({ ...valid, difficultRating: 'yes' })).toThrow(
      /difficultRating/,
    );
  });

  it('accepts a raw byTick deadline instead of byYear', () => {
    const def = parseScenarioFile(withObjective({ kind: 'guests', target: 10, byTick: 500 }));
    expect(def.objective.byTick).toBe(500);
    expect(def.objective.kind).toBe(ObjectiveKind.Guests);
  });

  it('maps monthly income objectives onto ledger category bits', () => {
    const def = parseScenarioFile(
      withObjective({
        kind: 'monthlyIncome',
        target: 0,
        categories: ['admission', 'rideTickets'],
        byYear: 2,
      }),
    );
    expect(def.objective.kind).toBe(ObjectiveKind.MonthlyIncome);
    expect(def.objective.categoryMask).toBe((1 << 4) | (1 << 5));
    expect(def.objective.byTick).toBe(2 * TICKS_PER_YEAR);
  });

  it('supports the full monthly income objective families', () => {
    const rideIncome = parseScenarioFile(
      withObjective({ kind: 'monthlyRideIncome', target: 12_000, byYear: 1 }),
    );
    const foodProfit = parseScenarioFile(
      withObjective({ kind: 'monthlyFoodProfit', target: 8_000, byYear: 1 }),
    );
    expect(rideIncome.objective.categoryMask).toBe(1 << LedgerCategory.RideTickets);
    expect(foodProfit.objective.categoryMask).toBe(
      (1 << LedgerCategory.FoodDrinkSales) | (1 << LedgerCategory.FoodDrinkStock),
    );
  });

  it('parses ride count and coaster qualification requirements', () => {
    const rides = parseScenarioFile(withObjective({ kind: 'buildRides', target: 12, byYear: 1 }));
    const coasters = parseScenarioFile(
      withObjective({
        kind: 'qualifyingCoasters',
        target: 10,
        minimumExcitement: 600,
        minimumLength: 1600,
        byYear: 2,
      }),
    );
    expect(rides.objective.target).toBe(12);
    expect(coasters.objective.target).toBe(10);
    expect(coasters.objective).toMatchObject({ minimumExcitement: 600, minimumLength: 1600 });
  });

  it('allows an open-ended Have Fun objective without a deadline', () => {
    const def = parseScenarioFile(withObjective({ kind: 'haveFun' }));
    expect(def.objective.target).toBe(0);
    expect(def.objective.byTick).toBe(0);
  });

  it('accepts the remaining documented objective families and thresholds', () => {
    const bestRide = parseScenarioFile(withObjective({ kind: 'bestRide', target: 700, byYear: 1 }));
    const complete = parseScenarioFile(
      withObjective({
        kind: 'completeCoasters',
        target: 5,
        minimumExcitement: 600,
        byYear: 2,
      }),
    );
    const guestsWithRatingFloor = parseScenarioFile(
      withObjective({ kind: 'guests', target: 100, minimumRating: 700, byYear: 1 }),
    );
    expect(bestRide.objective).toMatchObject({ target: 700 });
    expect(complete.objective).toMatchObject({ target: 5, minimumExcitement: 600 });
    expect(guestsWithRatingFloor.objective).toMatchObject({ target: 100, minimumRating: 700 });
  });

  it('defaults the entrance to none when the file omits it', () => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest.entrance;
    expect(parseScenarioFile(rest).entrance).toBeUndefined();
  });

  it('rejects an unknown objective kind with the field path in the message', () => {
    expect(() => parseScenarioFile(withObjective({ kind: 'fame', target: 1, byYear: 1 }))).toThrow(
      /test-park.*objective\.kind/,
    );
  });

  it('rejects an objective with no deadline', () => {
    expect(() => parseScenarioFile(withObjective({ kind: 'guests', target: 1 }))).toThrow(
      /byYear or byTick/,
    );
  });

  it('rejects a non-integer or negative money amount', () => {
    const bad = { ...valid, finance: { ...valid.finance, startingCash: 12.5 } };
    expect(() => parseScenarioFile(bad)).toThrow(/finance\.startingCash/);
  });

  it('rejects a map smaller than the minimum playable size', () => {
    const bad = { ...valid, map: { width: 4, height: 40 } };
    expect(() => parseScenarioFile(bad)).toThrow(/map\.width/);
  });

  it('rejects an unknown pricing mode', () => {
    const bad = { ...valid, pricing: { mode: 'tolls', admissionPrice: 0 } };
    expect(() => parseScenarioFile(bad)).toThrow(/pricing\.mode/);
  });

  it('rejects ids reserved for non-scenario saves', () => {
    expect(() => parseScenarioFile({ ...valid, id: 'sandbox' })).toThrow(/reserved/);
    expect(() => parseScenarioFile({ ...valid, id: 'imported' })).toThrow(/reserved/);
  });

  it('rejects a starting loan above the loan limit', () => {
    const bad = {
      ...valid,
      finance: { ...valid.finance, startingLoan: 20_000_000, maxLoan: 10_000_000 },
    };
    expect(() => parseScenarioFile(bad)).toThrow(/startingLoan must not exceed/);
  });

  it('rejects a negative objective target', () => {
    expect(() =>
      parseScenarioFile(withObjective({ kind: 'guests', target: -1, byYear: 1 })),
    ).toThrow(/objective\.target/);
  });

  it('rejects money beyond the exact-integer range of a park', () => {
    const bad = { ...valid, finance: { ...valid.finance, startingCash: Number.MAX_SAFE_INTEGER } };
    expect(() => parseScenarioFile(bad)).toThrow(/finance\.startingCash/);
  });

  it('rejects a missing id', () => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest.id;
    expect(() => parseScenarioFile(rest)).toThrow(/id/);
  });
});
