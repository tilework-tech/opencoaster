import { CAMPAIGNS } from '../sim/economy/marketing';
import { WEEKS_PER_YEAR } from '../sim/economy/calendar';
import { BASIS_POINTS } from '../sim/economy/ledger';
import { FUNDING_WEEKLY_CENTS } from '../sim/research/research';
import type { Snapshot } from '../worker/snapshot';

/** Cash below this many weeks of recurring bills raises a warning. */
export const LOW_CASH_WEEKS = 4;

export type CashLevel = 'ok' | 'low' | 'overdrawn';

export interface FinanceOutlook {
  wagesPerWeek: number;
  interestPerWeek: number;
  researchPerWeek: number;
  marketingPerWeek: number;
  upkeepPerWeek: number;
  /** Everything the park pays out every week, cents. */
  weeklyBills: number;
  /** Whole weeks the current cash covers the weekly bills; Infinity with no bills. */
  weeksOfCash: number;
  level: CashLevel;
}

/** What the park owes on a regular schedule, and whether its cash can carry it. */
export function financeOutlook(snapshot: Snapshot): FinanceOutlook {
  const e = snapshot.economy;
  const wagesPerWeek = e.wageBillPerWeek;
  const interestPerWeek = Math.floor(
    (snapshot.park.loan * e.annualInterestBps) / (BASIS_POINTS * WEEKS_PER_YEAR),
  );
  const researchPerWeek = FUNDING_WEEKLY_CENTS[snapshot.research.funding] ?? 0;
  const marketingPerWeek = CAMPAIGNS[e.campaignId]?.weeklyCostCents ?? 0;
  const upkeepPerWeek = Math.floor(e.rideUpkeepPerFortnight / 2);
  const weeklyBills =
    wagesPerWeek + interestPerWeek + researchPerWeek + marketingPerWeek + upkeepPerWeek;
  const cash = snapshot.park.cash;
  const weeksOfCash = weeklyBills === 0 ? Infinity : Math.max(0, Math.floor(cash / weeklyBills));
  const level: CashLevel =
    cash < 0 ? 'overdrawn' : weeklyBills > 0 && weeksOfCash < LOW_CASH_WEEKS ? 'low' : 'ok';
  return {
    wagesPerWeek,
    interestPerWeek,
    researchPerWeek,
    marketingPerWeek,
    upkeepPerWeek,
    weeklyBills,
    weeksOfCash,
    level,
  };
}

export function outlookMessage(o: FinanceOutlook): string {
  if (o.level === 'overdrawn') {
    return 'Overdrawn: nothing can be built until cash is positive. Borrow, raise prices or cut costs.';
  }
  if (o.level === 'low') {
    return `Cash covers only ${o.weeksOfCash} ${o.weeksOfCash === 1 ? 'week' : 'weeks'} of bills. Borrow or earn more before spending.`;
  }
  return '';
}
