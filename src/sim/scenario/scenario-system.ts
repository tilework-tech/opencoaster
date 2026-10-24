import type { System } from '../core/system';
import type { World } from '../core/world';
import { completedMonthTotal, LedgerCategory } from '../economy/ledger';
import { parkValueOf } from '../economy/park-rating';
import { ScenarioStatus, ObjectiveKind } from './scenario';
import type { ScenarioObjective } from './scenario';

/** Objectives are judged once, on the first tick at or after their deadline. */
export const scenarioSystem: System = {
  name: 'scenario',
  update(world: World) {
    const s = world.scenario;
    if (s.status !== ScenarioStatus.Active || !s.objective) return;
    if (world.tick < s.objective.byTick) return;
    s.status = meetsObjective(world, s.objective) ? ScenarioStatus.Won : ScenarioStatus.Lost;
  },
};

/** The live figure an objective compares with its target (guests, park value, and so on). */
export function objectiveMetric(world: World, o: ScenarioObjective): number {
  const l = world.economy;
  switch (o.kind) {
    case ObjectiveKind.Guests:
    case ObjectiveKind.GuestsAndRating:
      return world.guests.count;
    case ObjectiveKind.ParkValue:
    case ObjectiveKind.RepayLoanAndParkValue:
      return parkValueOf(world.guests.count, l.inputs);
    case ObjectiveKind.MonthlyIncome: {
      let net = 0;
      for (let c = 0; c < LedgerCategory.COUNT; c++) {
        if ((o.categoryMask >>> c) & 1) net += completedMonthTotal(l, c, 0);
      }
      return net;
    }
    case ObjectiveKind.QualifyingRides:
      return l.inputs.qualifyingRideCount;
  }
}

export function meetsObjective(world: World, o: ScenarioObjective): boolean {
  const metric = objectiveMetric(world, o) >= o.target;
  switch (o.kind) {
    case ObjectiveKind.GuestsAndRating:
      return metric && world.economy.parkRating >= o.rating;
    case ObjectiveKind.RepayLoanAndParkValue:
      return metric && world.economy.loan === 0;
    default:
      return metric;
  }
}
