/** Fixed cadences in simulation ticks (40 ticks per second). */
export const TICKS_PER_WEEK = 4096;
export const TICKS_PER_FORTNIGHT = 8192;
export const TICKS_PER_MONTH = 16384;
export const MONTHS_PER_YEAR = 8;
export const TICKS_PER_YEAR = TICKS_PER_MONTH * MONTHS_PER_YEAR;
export const WEEKS_PER_YEAR = TICKS_PER_YEAR / TICKS_PER_WEEK;
/** Park rating and park value refresh cadence (inferred from OpenRCT2 summaries). */
export const RATING_REFRESH_TICKS = 512;

const MONTH_NAMES = [
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
] as const;
/** Display labels only; every month is TICKS_PER_MONTH ticks long regardless. */
const MONTH_DAYS = [31, 30, 31, 30, 31, 30, 31, 30];

export interface GameDate {
  /** 1-based year. */
  year: number;
  /** 0-based index into the eight-month park year, 0 = March. */
  month: number;
  monthName: string;
  /** 1-based day label, spread evenly across the month's ticks. */
  day: number;
}

export function gameDate(tick: number): GameDate {
  const year = Math.floor(tick / TICKS_PER_YEAR) + 1;
  const month = Math.floor((tick % TICKS_PER_YEAR) / TICKS_PER_MONTH);
  const progress = tick % TICKS_PER_MONTH;
  const day = Math.floor((progress * MONTH_DAYS[month]) / TICKS_PER_MONTH) + 1;
  return { year, month, monthName: MONTH_NAMES[month], day };
}

/** A periodic event fires on the tick that reaches a multiple of its period, never on tick 0. */
export function isBoundary(tick: number, period: number): boolean {
  return tick > 0 && tick % period === 0;
}
