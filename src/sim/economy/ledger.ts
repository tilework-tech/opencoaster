/** Money is integer cents. Signed: income positive, expenses negative. */
export enum LedgerCategory {
  RideConstruction,
  RideRunning,
  Land,
  Landscaping,
  Admission,
  RideTickets,
  ShopSales,
  ShopStock,
  FoodDrinkSales,
  FoodDrinkStock,
  Wages,
  Marketing,
  Research,
  Interest,
  COUNT,
}

export enum PriceMode {
  Free = 0,
  Admission = 1,
  PerRide = 2,
}

export const BASIS_POINTS = 10_000;
export const HISTORY_MONTHS = 5;
export const NO_CAMPAIGN = -1;

/** Values reported by other systems (rides, staff, guests) that the economy reads each refresh. */
export interface EconomyInputs {
  /** Staff wages owed per week, cents. */
  wageBillPerWeek: number;
  /** Ride running costs charged per fortnight, cents. */
  rideUpkeepPerFortnight: number;
  /** Sum of ride values, cents (park value input). */
  rideValue: number;
  /** Count of rides meeting the scenario's qualifying criteria. */
  qualifyingRideCount: number;
  /** Open attractions (rides, not stalls). */
  openAttractionCount: number;
  /** Sum of open attractions' excitement and intensity, in 1/100 units. */
  excitementTotal: number;
  intensityTotal: number;
  /** Guests currently leaving after being lost. */
  lostGuests: number;
  /** Guests who are unhappy, as a whole percent (0-100). */
  unhappyPercent: number;
  /** Ride downtime, as a whole percent of ride-time (0-100). */
  rideDowntimePercent: number;
  litter: number;
  casualties: number;
}

export interface Ledger {
  cash: number;
  loan: number;
  maxLoan: number;
  annualInterestBps: number;
  priceMode: PriceMode;
  admissionPrice: number;
  inputs: EconomyInputs;
  /** Net per category for the month in progress. */
  monthlyTotals: Float64Array;
  /** Ring of the last HISTORY_MONTHS completed months, category-major within each month. */
  history: Float64Array;
  historyHead: number;
  monthsCompleted: number;
  campaignId: number;
  campaignWeeksLeft: number;
  parkValue: number;
  parkRating: number;
}

export function createLedger(): Ledger {
  return {
    cash: 1_000_000,
    loan: 0,
    maxLoan: 0,
    annualInterestBps: 0,
    priceMode: PriceMode.Free,
    admissionPrice: 0,
    inputs: {
      wageBillPerWeek: 0,
      rideUpkeepPerFortnight: 0,
      rideValue: 0,
      qualifyingRideCount: 0,
      openAttractionCount: 0,
      excitementTotal: 0,
      intensityTotal: 0,
      lostGuests: 0,
      unhappyPercent: 0,
      rideDowntimePercent: 0,
      litter: 0,
      casualties: 0,
    },
    monthlyTotals: new Float64Array(LedgerCategory.COUNT),
    history: new Float64Array(HISTORY_MONTHS * LedgerCategory.COUNT),
    historyHead: 0,
    monthsCompleted: 0,
    campaignId: NO_CAMPAIGN,
    campaignWeeksLeft: 0,
    parkValue: 0,
    parkRating: 0,
  };
}

export function post(l: Ledger, category: LedgerCategory, signedCents: number): void {
  l.cash += signedCents;
  l.monthlyTotals[category] += signedCents;
}

/** Net for a completed month: monthsAgo 0 is the most recent. Zero if that month never completed. */
export function completedMonthTotal(l: Ledger, category: LedgerCategory, monthsAgo = 0): number {
  if (monthsAgo < 0 || monthsAgo >= Math.min(l.monthsCompleted, HISTORY_MONTHS)) return 0;
  const slot = (l.historyHead - monthsAgo + HISTORY_MONTHS) % HISTORY_MONTHS;
  return l.history[slot * LedgerCategory.COUNT + category];
}

export function rollMonth(l: Ledger): void {
  l.historyHead = (l.historyHead + 1) % HISTORY_MONTHS;
  l.history.set(l.monthlyTotals, l.historyHead * LedgerCategory.COUNT);
  l.monthlyTotals.fill(0);
  l.monthsCompleted++;
}

export interface LedgerSave {
  cash: number;
  loan: number;
  maxLoan: number;
  annualInterestBps: number;
  priceMode: PriceMode;
  admissionPrice: number;
  inputs: EconomyInputs;
  monthlyTotals: number[];
  history: number[];
  historyHead: number;
  monthsCompleted: number;
  campaignId: number;
  campaignWeeksLeft: number;
  parkValue: number;
  parkRating: number;
}

export function saveLedger(l: Ledger): LedgerSave {
  return {
    cash: l.cash,
    loan: l.loan,
    maxLoan: l.maxLoan,
    annualInterestBps: l.annualInterestBps,
    priceMode: l.priceMode,
    admissionPrice: l.admissionPrice,
    inputs: { ...l.inputs },
    monthlyTotals: Array.from(l.monthlyTotals),
    history: Array.from(l.history),
    historyHead: l.historyHead,
    monthsCompleted: l.monthsCompleted,
    campaignId: l.campaignId,
    campaignWeeksLeft: l.campaignWeeksLeft,
    parkValue: l.parkValue,
    parkRating: l.parkRating,
  };
}

export function restoreLedger(l: Ledger, s: LedgerSave): void {
  l.cash = s.cash;
  l.loan = s.loan;
  l.maxLoan = s.maxLoan;
  l.annualInterestBps = s.annualInterestBps;
  l.priceMode = s.priceMode;
  l.admissionPrice = s.admissionPrice;
  l.inputs = { ...createLedger().inputs, ...s.inputs };
  l.monthlyTotals.set(s.monthlyTotals);
  l.history.set(s.history);
  l.historyHead = s.historyHead;
  l.monthsCompleted = s.monthsCompleted;
  l.campaignId = s.campaignId;
  l.campaignWeeksLeft = s.campaignWeeksLeft;
  l.parkValue = s.parkValue;
  l.parkRating = s.parkRating;
}
