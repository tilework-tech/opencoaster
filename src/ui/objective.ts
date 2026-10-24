import {
  gameDate,
  RATING_REFRESH_TICKS,
  TICKS_PER_MONTH,
  TICKS_PER_YEAR,
} from '../sim/economy/calendar';
import { ObjectiveKind, ScenarioStatus } from '../sim/scenario/scenario';
import type { SnapshotScenario } from '../worker/snapshot';
import { formatCents } from './hud';

/** Lines for the objective strip: outcome, progress against the target, and the deadline. */
export function objectiveLines(scenario: SnapshotScenario, loan: number, tick: number): string[] {
  const o = scenario.objective;
  if (!o) return [];
  const m = scenario.metric;
  // The rating is first computed at RATING_REFRESH_TICKS; until then the stored 0 is not a real value.
  const rating = tick < RATING_REFRESH_TICKS ? 'pending' : String(scenario.parkRating);
  const progress = (() => {
    switch (o.kind) {
      case ObjectiveKind.Guests:
        return `${m} / ${o.target} guests in the park`;
      case ObjectiveKind.GuestsAndRating:
        return `${m} / ${o.target} guests · rating ${rating} / ${o.rating}`;
      case ObjectiveKind.ParkValue:
        return `${formatCents(m)} / ${formatCents(o.target)} park value`;
      case ObjectiveKind.RepayLoanAndParkValue:
        return `repay the ${formatCents(loan)} loan and reach park value ${formatCents(o.target)}`;
      case ObjectiveKind.MonthlyIncome:
        return `${formatCents(m)} / ${formatCents(o.target)} net income last month`;
      case ObjectiveKind.QualifyingRides:
        return `${m} / ${o.target} qualifying rides`;
    }
  })();
  const outcome =
    scenario.status === ScenarioStatus.Won
      ? 'Objective met'
      : scenario.status === ScenarioStatus.Lost
        ? 'Objective missed'
        : 'Objective';
  return [`${outcome}: ${progress}`, `Deadline: ${deadlineText(o.byTick, tick)}`];
}

function deadlineText(byTick: number, tick: number): string {
  const when =
    byTick % TICKS_PER_YEAR === 0
      ? `end of year ${byTick / TICKS_PER_YEAR}`
      : `${gameDate(byTick - 1).monthName} year ${gameDate(byTick - 1).year}`;
  const left = byTick - tick;
  if (left <= 0) return when;
  return `${when} (${Math.ceil(left / TICKS_PER_MONTH)} months left)`;
}
