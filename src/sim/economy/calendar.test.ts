import { describe, expect, it } from 'vitest';
import {
  TICKS_PER_FORTNIGHT,
  TICKS_PER_MONTH,
  TICKS_PER_WEEK,
  TICKS_PER_YEAR,
  WEEKS_PER_YEAR,
  gameDate,
  isBoundary,
} from './calendar';

describe('calendar', () => {
  it('maps ticks to a March-first eight-month year', () => {
    expect(gameDate(0)).toEqual({ year: 1, month: 0, monthName: 'March', day: 1 });
    expect(gameDate(TICKS_PER_MONTH).monthName).toBe('April');
    expect(gameDate(TICKS_PER_YEAR - 1).monthName).toBe('October');
    expect(gameDate(TICKS_PER_YEAR)).toEqual({ year: 2, month: 0, monthName: 'March', day: 1 });
  });

  it('advances the day label across each fixed-length month', () => {
    expect(gameDate(TICKS_PER_MONTH / 2).day).toBe(16);
    expect(gameDate(TICKS_PER_MONTH - 1).day).toBe(31);
  });

  it('has the documented fixed cadences', () => {
    expect(TICKS_PER_WEEK).toBe(4096);
    expect(TICKS_PER_FORTNIGHT).toBe(8192);
    expect(TICKS_PER_MONTH).toBe(16384);
    expect(WEEKS_PER_YEAR).toBe(32);
  });

  it('fires boundaries on the tick that reaches them, never at tick zero', () => {
    expect(isBoundary(0, TICKS_PER_WEEK)).toBe(false);
    expect(isBoundary(TICKS_PER_WEEK, TICKS_PER_WEEK)).toBe(true);
    expect(isBoundary(TICKS_PER_WEEK + 1, TICKS_PER_WEEK)).toBe(false);
  });
});
