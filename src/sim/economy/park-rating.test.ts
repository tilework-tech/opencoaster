import { describe, expect, it } from 'vitest';
import {
  IDEAL_EXCITEMENT,
  IDEAL_INTENSITY,
  MAX_RATING,
  VARIETY_TOTAL,
  DIFFICULT_RATING_BASE,
  computeParkRating,
  parkValueOf,
} from './park-rating';
import { createLedger } from './ledger';

/** A park whose attractions sit at the ideal averages and clear both variety totals. */
const quiet = {
  ...createLedger().inputs,
  openAttractionCount: 40,
  excitementTotal: 40 * IDEAL_EXCITEMENT,
  intensityTotal: 40 * IDEAL_INTENSITY,
};

describe('park value', () => {
  it('adds $7 per guest to the ride value total', () => {
    expect(parkValueOf(10, { ...quiet, rideValue: 5_000 })).toBe(5_000 + 10 * 700);
  });
});

describe('park rating', () => {
  it('always stays within 0..999', () => {
    const disaster = {
      ...quiet,
      lostGuests: 500,
      unhappyPercent: 100,
      casualties: 50,
      litter: 1000,
    };
    expect(computeParkRating(0, disaster)).toBe(0);
    expect(computeParkRating(2000, quiet)).toBeLessThanOrEqual(MAX_RATING);
  });

  it('gets worse with more lost guests beyond the first 25', () => {
    expect(computeParkRating(0, { ...quiet, lostGuests: 35 })).toBe(930);
    expect(computeParkRating(0, { ...quiet, lostGuests: 125 })).toBe(300);
  });

  it('gets worse with ride downtime, litter and casualties', () => {
    expect(computeParkRating(0, { ...quiet, rideDowntimePercent: 10 })).toBe(980);
    expect(computeParkRating(0, { ...quiet, litter: 3 })).toBe(988);
    expect(computeParkRating(0, { ...quiet, casualties: 2 })).toBe(800);
  });
});

describe('park rating ride terms', () => {
  it('does not reach the cap for a park with no open attractions', () => {
    expect(computeParkRating(0, createLedger().inputs)).toBeLessThan(MAX_RATING - 200);
  });

  it('rewards attractions that approach the ideal averages', () => {
    const gentle = {
      ...quiet,
      openAttractionCount: 40,
      excitementTotal: 40 * 150,
      intensityTotal: 40 * 100,
    };
    expect(computeParkRating(0, gentle)).toBeLessThan(computeParkRating(0, quiet));
  });

  it('forgives a small total only as excitement and intensity add up', () => {
    const few = (total: number) => ({
      ...quiet,
      openAttractionCount: 1,
      excitementTotal: total,
      intensityTotal: total,
    });
    expect(computeParkRating(0, few(VARIETY_TOTAL / 2))).toBeGreaterThan(
      computeParkRating(0, few(VARIETY_TOTAL / 4)),
    );
  });

  it('keeps a modest starter park under the cap', () => {
    const starter = {
      ...quiet,
      openAttractionCount: 4,
      excitementTotal: 360 + 450 + 620 + 580,
      intensityTotal: 120 + 100 + 540 + 680,
    };
    expect(computeParkRating(60, starter)).toBeLessThan(MAX_RATING);
    expect(computeParkRating(60, starter)).toBeGreaterThan(500);
  });
});

describe('park rating happiness', () => {
  /** Litter keeps this park under the 999 cap, so penalties show in the score. */
  const below = { ...quiet, litter: 50 };
  const withHappiness = (unhappyPercent: number) => ({ ...below, unhappyPercent });

  it('charges the full 500 when no guest is happy', () => {
    expect(computeParkRating(0, below)).toBe(800);
    expect(computeParkRating(0, withHappiness(100))).toBe(300);
  });

  it('charges 200 when half the guests are happy', () => {
    expect(computeParkRating(0, withHappiness(50))).toBe(600);
  });

  it('charges nothing once about 83% of guests are happy', () => {
    expect(computeParkRating(0, withHappiness(16))).toBe(800);
    expect(computeParkRating(0, withHappiness(17))).toBe(798);
  });

  it('charges nothing for a park with no guests', () => {
    expect(computeParkRating(0, withHappiness(0))).toBe(800);
  });
});

describe('park rating difficulty', () => {
  it('starts from 1,050 instead of 1,150 when difficult rating is on', () => {
    const below = { ...quiet, litter: 50 };
    expect(computeParkRating(0, below, DIFFICULT_RATING_BASE)).toBe(700);
  });
});
