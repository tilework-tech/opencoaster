import type { System } from '../core/system';
import type { World } from '../core/world';
import { completedMonthTotal, LedgerCategory } from '../economy/ledger';
import { parkValueOf } from '../economy/park-rating';
import { ScenarioStatus, ObjectiveKind } from './scenario';
import type { ScenarioObjective } from './scenario';
import { RIDE_CATALOG, type RideType } from '../rides/ride-types';
import { RideState } from '../rides/ride-store';
import { isShopCategory } from '../rides/ride-operations';

/** Objectives are judged once, on the first tick at or after their deadline. */
export const scenarioSystem: System = {
  name: 'scenario',
  update(world: World) {
    const s = world.scenario;
    if (s.status !== ScenarioStatus.Active || !s.objective) return;
    if (s.objective.kind === ObjectiveKind.HaveFun) return;
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
      return countQualifyingRides(world);
    case ObjectiveKind.BuildRides:
      return world.rides.count;
    case ObjectiveKind.QualifyingCoasters: {
      const types = new Set<number>();
      for (let slot = 0; slot < world.rides.count; slot++) {
        const type = world.rides.cols.typeId[slot] as RideType;
        const definition = RIDE_CATALOG[type];
        if (!definition?.usesTrack || world.rides.cols.state[slot] !== RideState.Open) continue;
        if (world.rides.cols.excitement[slot] < (o.minimumExcitement ?? 0)) continue;
        if (world.track.length[world.rides.slotToId[slot]] < (o.minimumLength ?? 0)) continue;
        types.add(type);
      }
      return types.size;
    }
    case ObjectiveKind.CompleteCoasters: {
      let count = 0;
      for (let slot = 0; slot < world.rides.count; slot++) {
        const id = world.rides.slotToId[slot];
        const type = world.rides.cols.typeId[slot] as RideType;
        if (
          RIDE_CATALOG[type]?.usesTrack &&
          world.track.closed[id] !== 0 &&
          world.rides.cols.excitement[slot] >= (o.minimumExcitement ?? 0)
        )
          count++;
      }
      return count;
    }
    case ObjectiveKind.BestRide: {
      let best = 0;
      for (let slot = 0; slot < world.rides.count; slot++) {
        if (world.rides.cols.state[slot] === RideState.Open)
          best = Math.max(best, world.rides.cols.excitement[slot]);
      }
      return best;
    }
    case ObjectiveKind.HaveFun:
      return 1;
  }
}

function countQualifyingRides(world: World): number {
  let count = 0;
  for (let slot = 0; slot < world.rides.count; slot++) {
    const definition = RIDE_CATALOG[world.rides.cols.typeId[slot] as RideType];
    if (
      definition &&
      !isShopCategory(definition.category) &&
      world.rides.cols.state[slot] === RideState.Open
    ) {
      count++;
    }
  }
  return count;
}

export function meetsObjective(world: World, o: ScenarioObjective): boolean {
  const metric = objectiveMetric(world, o) >= o.target;
  switch (o.kind) {
    case ObjectiveKind.GuestsAndRating:
      return metric && world.economy.parkRating >= o.rating;
    case ObjectiveKind.RepayLoanAndParkValue:
      return metric && world.economy.loan === 0;
    case ObjectiveKind.Guests:
      return metric && world.economy.parkRating >= (o.minimumRating ?? 0);
    case ObjectiveKind.HaveFun:
      return false;
    default:
      return metric;
  }
}
