import { describe, expect, it } from 'vitest';
import { LedgerCategory } from '../sim/economy/ledger';
import { ObjectiveKind } from '../sim/scenario/scenario';
import type { ScenarioDef } from '../sim/scenario/scenario';
import { objectiveText } from './title-screen';

function scenario(
  kind: ObjectiveKind,
  target: number,
  byTick = 512,
  categoryMask = 0,
): ScenarioDef {
  return {
    id: 'title-test',
    name: 'Title Test',
    seed: 1,
    mapWidth: 16,
    mapHeight: 16,
    startingCash: 1_000_000,
    startingLoan: 0,
    maxLoan: 0,
    annualInterestBps: 0,
    difficultRating: false,
    priceMode: 0,
    admissionPrice: 0,
    availableItemIds: [],
    inventions: [],
    objective: { kind, target, rating: 0, categoryMask, byTick },
  };
}

describe('title screen objective descriptions', () => {
  it('describes each ride-building objective', () => {
    expect(objectiveText(scenario(ObjectiveKind.QualifyingRides, 5))).toContain(
      'build 5 qualifying rides',
    );
    expect(objectiveText(scenario(ObjectiveKind.BuildRides, 12))).toContain('build 12 rides');
    expect(objectiveText(scenario(ObjectiveKind.QualifyingCoasters, 3))).toContain(
      'build 3 qualifying coaster types',
    );
    expect(objectiveText(scenario(ObjectiveKind.CompleteCoasters, 2))).toContain(
      'build 2 complete coasters',
    );
    expect(objectiveText(scenario(ObjectiveKind.BestRide, 700))).toContain(
      'have a ride with excitement of at least 700',
    );
  });

  it('describes Have Fun without inventing a deadline', () => {
    expect(objectiveText(scenario(ObjectiveKind.HaveFun, 0, 0))).toBe(
      'Objective: have fun. No deadline.',
    );
  });

  it('distinguishes ride-ticket income from food and drink profit', () => {
    expect(
      objectiveText(
        scenario(ObjectiveKind.MonthlyIncome, 12_000, 512, 1 << LedgerCategory.RideTickets),
      ),
    ).toContain('monthly ride ticket income');

    expect(
      objectiveText(
        scenario(
          ObjectiveKind.MonthlyIncome,
          8_000,
          512,
          (1 << LedgerCategory.FoodDrinkSales) | (1 << LedgerCategory.FoodDrinkStock),
        ),
      ),
    ).toContain('monthly food and drink profit');
  });
});
