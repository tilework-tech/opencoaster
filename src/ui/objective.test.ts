import { describe, expect, it } from 'vitest';
import { TICKS_PER_MONTH, TICKS_PER_YEAR } from '../sim/economy/calendar';
import { ObjectiveKind, ScenarioStatus } from '../sim/scenario/scenario';
import type { SnapshotScenario } from '../worker/snapshot';
import { objectiveLines } from './objective';

function scenario(
  overrides: Partial<SnapshotScenario> & { byTick?: number; kind?: ObjectiveKind } = {},
): SnapshotScenario {
  const { byTick = TICKS_PER_YEAR, kind = ObjectiveKind.GuestsAndRating, ...rest } = overrides;
  return {
    status: ScenarioStatus.Active,
    objective: { kind, target: 10, rating: 600, categoryMask: 0, byTick },
    metric: 4,
    parkRating: 512,
    ...rest,
  };
}

describe('objectiveLines', () => {
  it('shows guest and rating progress against the targets and the deadline', () => {
    expect(objectiveLines(scenario(), 0, 1024)).toEqual([
      'Objective: 4 / 10 guests · rating 512 / 600',
      'Deadline: end of year 1 (8 months left)',
    ]);
  });

  it('shows the rating as pending until the first rating refresh', () => {
    expect(objectiveLines(scenario(), 0, 0)[0]).toBe(
      'Objective: 4 / 10 guests · rating pending / 600',
    );
  });

  it('reports a met objective once the scenario is won', () => {
    const lines = objectiveLines(scenario({ status: ScenarioStatus.Won, metric: 12 }), 0, 0);
    expect(lines[0]).toMatch(/^Objective met/);
  });

  it('reports a missed objective once the deadline has passed', () => {
    const lines = objectiveLines(scenario({ status: ScenarioStatus.Lost }), 0, 0);
    expect(lines[0]).toMatch(/^Objective missed/);
  });

  it('formats money in dollars for park value objectives', () => {
    const lines = objectiveLines(
      scenario({
        kind: ObjectiveKind.ParkValue,
        metric: 123_456,
        objective: {
          kind: ObjectiveKind.ParkValue,
          target: 500_000,
          rating: 0,
          categoryMask: 0,
          byTick: TICKS_PER_YEAR,
        },
      }),
      0,
      0,
    );
    expect(lines[0]).toBe('Objective: $1,234.56 / $5,000.00 park value');
  });

  it('names the loan for repay objectives', () => {
    const lines = objectiveLines(
      scenario({
        objective: {
          kind: ObjectiveKind.RepayLoanAndParkValue,
          target: 0,
          rating: 0,
          categoryMask: 0,
          byTick: TICKS_PER_YEAR,
        },
      }),
      250_000,
      0,
    );
    expect(lines[0]).toBe('Objective: repay the $2,500.00 loan and reach park value $0.00');
  });

  it('counts down the months left until the deadline', () => {
    const lines = objectiveLines(scenario(), 0, TICKS_PER_YEAR - 2 * TICKS_PER_MONTH);
    expect(lines[1]).toBe('Deadline: end of year 1 (2 months left)');
  });

  it('shows the calendar day for an in-year deadline', () => {
    expect(objectiveLines(scenario({ byTick: TICKS_PER_MONTH }), 0, 0)[1]).toBe(
      'Deadline: March 31, year 1 (1 months left)',
    );
  });

  it('is empty for sandbox games', () => {
    expect(objectiveLines({ ...scenario(), objective: null }, 0, 0)).toEqual([]);
  });
});
