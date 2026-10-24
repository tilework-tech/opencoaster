import { describe, expect, it } from 'vitest';
import { SampleSeries, formatDate, formatMoney, parsePriceCents, stepPrice } from './format';

describe('price controls', () => {
  it('steps by ten cents and stays within the sim limits', () => {
    expect(stepPrice(100, 1, 65535)).toBe(110);
    expect(stepPrice(5, -1, 65535)).toBe(0);
    expect(stepPrice(65530, 1, 65535)).toBe(65535);
  });

  it('parses typed dollar amounts to whole cents and rejects junk', () => {
    expect(parsePriceCents('3.5')).toBe(350);
    expect(parsePriceCents('$12')).toBe(1200);
    expect(parsePriceCents('abc')).toBeNull();
    expect(parsePriceCents('-1')).toBeNull();
    expect(parsePriceCents('999999')).toBeNull();
  });
});

describe('formatting', () => {
  it('formats money with sign and thousands separators', () => {
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(-500)).toBe('-$5.00');
  });

  it('formats the in-game date', () => {
    expect(formatDate(0)).toBe('1 March, Year 1');
    expect(formatDate(16384 * 8)).toBe('1 March, Year 2');
  });
});

describe('sample series', () => {
  it('records at most one sample per interval and drops the oldest past capacity', () => {
    const series = new SampleSeries(3, 100);
    series.record(0, 1);
    series.record(50, 2);
    series.record(100, 3);
    series.record(200, 4);
    series.record(300, 5);
    expect(series.values()).toEqual([3, 4, 5]);
  });

  it('clears when time runs backwards', () => {
    const series = new SampleSeries(3, 100);
    series.record(500, 1);
    series.record(10, 2);
    expect(series.values()).toEqual([2]);
  });
});
