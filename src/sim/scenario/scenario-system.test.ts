import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { TICKS_PER_MONTH } from '../economy/calendar';
import { setEconomyInputs } from '../economy/api';
import { LedgerCategory } from '../economy/ledger';
import { applyScenario, ObjectiveKind, ScenarioStatus } from './scenario';
import type { ScenarioDef, ScenarioObjective } from './scenario';

function def(objective: ScenarioObjective): ScenarioDef {
  return {
    id: 'obj',
    name: 'objective',
    seed: 1,
    mapWidth: 16,
    mapHeight: 16,
    startingCash: 1_000_000,
    startingLoan: 0,
    maxLoan: 0,
    annualInterestBps: 0,
    priceMode: 0,
    admissionPrice: 0,
    availableItemIds: [],
    inventions: [],
    objective,
  };
}

function play(objective: ScenarioObjective, setup: (s: Simulation) => void): ScenarioStatus {
  const s = new Simulation({ seed: 1, width: 16, height: 16 });
  applyScenario(s.world, def(objective));
  setup(s);
  for (let i = 0; i < objective.byTick + 1; i++) s.step();
  return s.world.scenario.status;
}

describe('scenario objectives', () => {
  it('wins a park-value goal when the value meets the target at the deadline', () => {
    const status = play(
      { kind: ObjectiveKind.ParkValue, target: 5_000, rating: 0, categoryMask: 0, byTick: 512 },
      (s) => setEconomyInputs(s.world, { rideValue: 5_000 }),
    );
    expect(status).toBe(ScenarioStatus.Won);
  });

  it('loses a park-value goal when the deadline passes below target', () => {
    const status = play(
      { kind: ObjectiveKind.ParkValue, target: 5_000, rating: 0, categoryMask: 0, byTick: 512 },
      (s) => setEconomyInputs(s.world, { rideValue: 4_999 }),
    );
    expect(status).toBe(ScenarioStatus.Lost);
  });

  it('wins a loan-repayment goal only when the loan is zero and value is met', () => {
    const won = play(
      {
        kind: ObjectiveKind.RepayLoanAndParkValue,
        target: 100,
        rating: 0,
        categoryMask: 0,
        byTick: 512,
      },
      (s) => setEconomyInputs(s.world, { rideValue: 100 }),
    );
    expect(won).toBe(ScenarioStatus.Won);
    const lost = play(
      {
        kind: ObjectiveKind.RepayLoanAndParkValue,
        target: 100,
        rating: 0,
        categoryMask: 0,
        byTick: 512,
      },
      (s) => {
        s.world.economy.loan = 1;
        setEconomyInputs(s.world, { rideValue: 100 });
      },
    );
    expect(lost).toBe(ScenarioStatus.Lost);
  });

  it('judges monthly income on the most recently completed month', () => {
    const won = play(
      {
        kind: ObjectiveKind.MonthlyIncome,
        target: 1_000,
        rating: 0,
        categoryMask: 1 << LedgerCategory.RideTickets,
        byTick: TICKS_PER_MONTH,
      },
      (s) => {
        s.world.economy.monthlyTotals[LedgerCategory.RideTickets] = 1_000;
      },
    );
    expect(won).toBe(ScenarioStatus.Won);
  });

  it('ignores the objective until its deadline', () => {
    const s = new Simulation({ seed: 1, width: 16, height: 16 });
    applyScenario(
      s.world,
      def({ kind: ObjectiveKind.Guests, target: 0, rating: 0, categoryMask: 0, byTick: 100 }),
    );
    for (let i = 0; i < 99; i++) s.step();
    expect(s.world.scenario.status).toBe(ScenarioStatus.Active);
  });
});
