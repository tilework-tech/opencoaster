import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { TICKS_PER_MONTH } from '../economy/calendar';
import { LedgerCategory } from '../economy/ledger';
import { applyScenario, ObjectiveKind, ScenarioStatus } from './scenario';
import type { ScenarioDef, ScenarioObjective } from './scenario';
import { RideState } from '../rides/ride-store';
import { RideType } from '../rides/ride-types';
import { meetsObjective } from './scenario-system';
import { spawnGuest } from '../guests/guest-store';

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
    difficultRating: false,
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
      (s) => s.enqueue({ type: 'spawnGuests', count: 8 }),
    );
    expect(status).toBe(ScenarioStatus.Won);
  });

  it('loses a park-value goal when the deadline passes below target', () => {
    const status = play(
      { kind: ObjectiveKind.ParkValue, target: 5_000, rating: 0, categoryMask: 0, byTick: 512 },
      (s) => s.enqueue({ type: 'spawnGuests', count: 7 }),
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
      (s) => s.enqueue({ type: 'spawnGuests', count: 1 }),
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
        s.enqueue({ type: 'spawnGuests', count: 1 });
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

  it('wins a build-rides objective from rides the park has built', () => {
    const status = play(
      { kind: ObjectiveKind.BuildRides, target: 1, rating: 0, categoryMask: 0, byTick: 512 },
      (s) => {
        const slot = s.world.rides.spawn();
        s.world.rides.cols.typeId[slot] = RideType.MerryGoRound;
      },
    );
    expect(status).toBe(ScenarioStatus.Won);
  });

  it('counts currently open qualifying rides at an arbitrary deadline', () => {
    const s = new Simulation({ seed: 1, width: 16, height: 16 });
    const objective: ScenarioObjective = {
      kind: ObjectiveKind.QualifyingRides,
      target: 1,
      rating: 0,
      categoryMask: 0,
      byTick: 513,
    };
    const slot = s.world.rides.spawn();
    s.world.rides.cols.typeId[slot] = RideType.MerryGoRound;
    s.world.rides.cols.state[slot] = RideState.Open;
    s.world.economy.inputs.qualifyingRideCount = 0;

    expect(meetsObjective(s.world, objective)).toBe(true);
  });

  it('requires coaster type, rating, and track length for qualifying coaster goals', () => {
    const s = new Simulation({ seed: 1, width: 16, height: 16 });
    const slot = s.world.rides.spawn();
    const id = s.world.rides.slotToId[slot];
    s.world.rides.cols.typeId[slot] = RideType.WoodenCoaster;
    s.world.rides.cols.state[slot] = RideState.Open;
    s.world.rides.cols.excitement[slot] = 650;
    s.world.track.length[id] = 5;
    const objective: ScenarioObjective = {
      kind: ObjectiveKind.QualifyingCoasters,
      target: 1,
      rating: 0,
      categoryMask: 0,
      byTick: 512,
      minimumExcitement: 600,
      minimumLength: 5,
    };
    expect(meetsObjective(s.world, objective)).toBe(true);
  });

  it('counts only completed coasters for the finish-coaster objective', () => {
    const status = play(
      {
        kind: ObjectiveKind.CompleteCoasters,
        target: 1,
        rating: 0,
        categoryMask: 0,
        byTick: 512,
        minimumExcitement: 600,
      },
      (s) => {
        const slot = s.world.rides.spawn();
        const id = s.world.rides.slotToId[slot];
        s.world.rides.cols.typeId[slot] = RideType.WoodenCoaster;
        s.world.rides.cols.excitement[slot] = 650;
        s.world.track.closed[id] = 1;
      },
    );
    expect(status).toBe(ScenarioStatus.Won);
  });

  it('leaves Have Fun scenarios active without a deadline', () => {
    const s = new Simulation({ seed: 1, width: 16, height: 16 });
    applyScenario(
      s.world,
      def({ kind: ObjectiveKind.HaveFun, target: 0, rating: 0, categoryMask: 0, byTick: 0 }),
    );
    for (let i = 0; i < 1000; i++) s.step();
    expect(s.world.scenario.status).toBe(ScenarioStatus.Active);
  });

  it('enforces the rating floor on a guest-count objective', () => {
    const objective: ScenarioObjective = {
      kind: ObjectiveKind.Guests,
      target: 1,
      rating: 0,
      minimumRating: 700,
      categoryMask: 0,
      byTick: 512,
    };
    const s = new Simulation({ seed: 1, width: 16, height: 16 });
    applyScenario(s.world, def(objective));
    s.world.economy.parkRating = 700;
    expect(meetsObjective(s.world, objective)).toBe(false);
    spawnGuest(s.world);
    s.world.economy.parkRating = 600;
    expect(meetsObjective(s.world, objective)).toBe(false);
    s.world.economy.parkRating = 700;
    expect(meetsObjective(s.world, objective)).toBe(true);
  });
});
