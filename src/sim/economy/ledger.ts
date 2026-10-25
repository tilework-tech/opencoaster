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
export const NO_TARGET = -1;

export interface ParkValueRide {
  valueCents: number;
  ridersLast5Minutes: number;
  typeBonus: number;
}

export interface ActiveAward {
  awardId: number;
  expiresTick: number;
}

export interface ParkNewsItem {
  tick: number;
  awardId: number;
  text: string;
  positive: boolean;
}

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
  drowningCasualties: number;
  fatalRideCrashes: number;
  /** Remaining rating penalty after monthly decay, in points. */
  drowningCasualtyPenalty: number;
  fatalRideCrashPenalty: number;
}

export interface Ledger {
  cash: number;
  loan: number;
  maxLoan: number;
  annualInterestBps: number;
  /** Scenario option: the park rating starts from the lower difficult-rating base. */
  difficultRating: boolean;
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
  /** Ride or item the running campaign targets, or NO_TARGET. */
  campaignTarget: number;
  parkValue: number;
  parkRating: number;
  activeAwards: ActiveAward[];
  parkNews: ParkNewsItem[];
}

export function createLedger(): Ledger {
  return {
    cash: 1_000_000,
    loan: 0,
    maxLoan: 0,
    annualInterestBps: 0,
    difficultRating: false,
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
      drowningCasualties: 0,
      fatalRideCrashes: 0,
      drowningCasualtyPenalty: 0,
      fatalRideCrashPenalty: 0,
    },
    monthlyTotals: new Float64Array(LedgerCategory.COUNT),
    history: new Float64Array(HISTORY_MONTHS * LedgerCategory.COUNT),
    historyHead: 0,
    monthsCompleted: 0,
    campaignId: NO_CAMPAIGN,
    campaignWeeksLeft: 0,
    campaignTarget: NO_TARGET,
    parkValue: 0,
    parkRating: 0,
    activeAwards: [],
    parkNews: [],
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
  difficultRating?: boolean;
  priceMode: PriceMode;
  admissionPrice: number;
  inputs: EconomyInputs;
  monthlyTotals: number[];
  history: number[];
  historyHead: number;
  monthsCompleted: number;
  campaignId: number;
  campaignWeeksLeft: number;
  campaignTarget?: number;
  parkValue: number;
  parkRating: number;
  activeAwards?: ActiveAward[];
  parkNews?: ParkNewsItem[];
}

export function saveLedger(l: Ledger): LedgerSave {
  return {
    cash: l.cash,
    loan: l.loan,
    maxLoan: l.maxLoan,
    annualInterestBps: l.annualInterestBps,
    difficultRating: l.difficultRating,
    priceMode: l.priceMode,
    admissionPrice: l.admissionPrice,
    inputs: { ...l.inputs },
    monthlyTotals: Array.from(l.monthlyTotals),
    history: Array.from(l.history),
    historyHead: l.historyHead,
    monthsCompleted: l.monthsCompleted,
    campaignId: l.campaignId,
    campaignWeeksLeft: l.campaignWeeksLeft,
    campaignTarget: l.campaignTarget,
    parkValue: l.parkValue,
    parkRating: l.parkRating,
    activeAwards: l.activeAwards.map((award) => ({ ...award })),
    parkNews: l.parkNews.map((item) => ({ ...item })),
  };
}

export function restoreLedger(l: Ledger, s: LedgerSave): void {
  l.cash = s.cash;
  l.loan = s.loan;
  l.maxLoan = s.maxLoan;
  l.annualInterestBps = s.annualInterestBps;
  l.difficultRating = s.difficultRating ?? false;
  l.priceMode = s.priceMode;
  l.admissionPrice = s.admissionPrice;
  l.inputs = { ...createLedger().inputs, ...s.inputs };
  l.monthlyTotals.set(s.monthlyTotals);
  l.history.set(s.history);
  l.historyHead = s.historyHead;
  l.monthsCompleted = s.monthsCompleted;
  l.campaignId = s.campaignId;
  l.campaignWeeksLeft = s.campaignWeeksLeft;
  l.campaignTarget = s.campaignTarget ?? NO_TARGET;
  l.parkValue = s.parkValue;
  l.parkRating = s.parkRating;
  l.activeAwards = (s.activeAwards ?? []).map((award) => ({ ...award }));
  l.parkNews = (s.parkNews ?? []).map((item) => ({ ...item }));
}
