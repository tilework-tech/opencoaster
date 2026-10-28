import { describe, expect, it } from 'vitest';
import { createSnapshot } from '../worker/snapshot';
import { financeOutlook } from './finance-outlook';

function snapshotWith(patch: {
  cash: number;
  loan?: number;
  bps?: number;
  wages?: number;
  upkeep?: number;
  funding?: number;
}) {
  const s = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });
  s.park.cash = patch.cash;
  s.park.loan = patch.loan ?? 0;
  s.economy.annualInterestBps = patch.bps ?? 0;
  s.economy.wageBillPerWeek = patch.wages ?? 0;
  s.economy.rideUpkeepPerFortnight = patch.upkeep ?? 0;
  s.research.funding = patch.funding ?? 0;
  return s;
}

describe('finance outlook', () => {
  it('sums the recurring bills into a weekly figure', () => {
    const o = financeOutlook(
      snapshotWith({
        cash: 1_000_000,
        loan: 3_200_000,
        bps: 1000,
        wages: 2000,
        upkeep: 1000,
        funding: 2,
      }),
    );
    expect(o.interestPerWeek).toBe(10_000);
    expect(o.researchPerWeek).toBe(5000);
    expect(o.weeklyBills).toBe(2000 + 500 + 10_000 + 5000);
  });

  it('is healthy while cash covers a month of bills', () => {
    expect(financeOutlook(snapshotWith({ cash: 10_000, wages: 2000 })).level).toBe('ok');
  });

  it('warns when cash will not cover the next four weeks of bills', () => {
    const o = financeOutlook(snapshotWith({ cash: 7_999, wages: 2000 }));
    expect(o.level).toBe('low');
    expect(o.weeksOfCash).toBe(3);
  });

  it('flags an overdrawn park', () => {
    expect(financeOutlook(snapshotWith({ cash: -1, wages: 2000 })).level).toBe('overdrawn');
  });

  it('never warns about a park with no bills', () => {
    expect(financeOutlook(snapshotWith({ cash: 0 })).level).toBe('ok');
  });
});
