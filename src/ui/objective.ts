import { gameDate, RATING_REFRESH_TICKS, TICKS_PER_MONTH } from '../sim/economy/calendar';
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
        return `${m} / ${o.target} guests in the park${(o.minimumRating ?? 0) > 0 ? ` · rating at least ${o.minimumRating}` : ''}`;
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
      case ObjectiveKind.BuildRides:
        return `${m} / ${o.target} rides built`;
      case ObjectiveKind.QualifyingCoasters:
        return `${m} / ${o.target} qualifying coaster types`;
      case ObjectiveKind.CompleteCoasters:
        return `${m} / ${o.target} completed coasters`;
      case ObjectiveKind.BestRide:
        return `Best ride excitement ${m} / ${o.target}`;
      case ObjectiveKind.HaveFun:
        return 'Have fun in the park';
    }
  })();
  const outcome =
    scenario.status === ScenarioStatus.Won
      ? 'Objective met'
      : scenario.status === ScenarioStatus.Lost
        ? 'Objective missed'
        : 'Objective';
  return o.kind === ObjectiveKind.HaveFun
    ? [`${outcome}: ${progress}`]
    : [`${outcome}: ${progress}`, `Deadline: ${deadlineText(o.byTick, tick)}`];
}

/** The date an objective is judged on, as shown on the scenario card, the strip and the outcome. */
export function deadlineLabel(byTick: number): string {
  const date = gameDate(byTick);
  const endOfMonth = (byTick + 1) % TICKS_PER_MONTH === 0;
  return endOfMonth
    ? `end of ${date.monthName}, year ${date.year}`
    : `${date.monthName} ${date.day}, year ${date.year}`;
}

function deadlineText(byTick: number, tick: number): string {
  const when = deadlineLabel(byTick);
  const left = byTick - tick;
  if (left <= 0) return when;
  if (left < TICKS_PER_MONTH) return `${when} (this month)`;
  return `${when} (${Math.ceil(left / TICKS_PER_MONTH)} months left)`;
}
