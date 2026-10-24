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

export function meetsObjective(world: World, o: ScenarioObjective): boolean {
  const l = world.economy;
  const guests = world.guests.count;
  switch (o.kind) {
    case ObjectiveKind.Guests:
      return guests >= o.target;
    case ObjectiveKind.ParkValue:
      return parkValueOf(guests, l.inputs) >= o.target;
    case ObjectiveKind.GuestsAndRating:
      return guests >= o.target && l.parkRating >= o.rating;
    case ObjectiveKind.RepayLoanAndParkValue:
      return l.loan === 0 && parkValueOf(guests, l.inputs) >= o.target;
    case ObjectiveKind.MonthlyIncome: {
      let net = 0;
      for (let c = 0; c < LedgerCategory.COUNT; c++) {
        if ((o.categoryMask >>> c) & 1) net += completedMonthTotal(l, c, 0);
      }
      return net >= o.target;
    }
    case ObjectiveKind.QualifyingRides:
      return l.inputs.qualifyingRideCount >= o.target;
  }
}
