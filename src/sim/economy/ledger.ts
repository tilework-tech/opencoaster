export const enum LedgerCategory {
  RideTickets = 0,
  ShopSales = 1,
  ParkEntry = 2,
  Construction = 3,
  Wages = 4,
  Marketing = 5,
  Research = 6,
  Loan = 7,
  COUNT = 8,
}

/** Money is integer cents. Per-category totals are for the current month. */
export interface Ledger {
  cash: number;
  loan: number;
  monthlyTotals: Int32Array;
}

export function createLedger(): Ledger {
  return { cash: 1_000_000, loan: 0, monthlyTotals: new Int32Array(LedgerCategory.COUNT) };
}

export function record(l: Ledger, category: LedgerCategory, cents: number): void {
  l.cash += cents;
  l.monthlyTotals[category] += cents;
}
