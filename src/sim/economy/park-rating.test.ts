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

  it('includes recent riders and a ride-type bonus in each ride contribution', async () => {
    expect(
      parkValueOf(0, quiet, [{ valueCents: 10_000, ridersLast5Minutes: 20, typeBonus: 30 }]),
    ).toBe(1_400_000);
  });
});

describe('park rating', () => {
  const casualtyBase = { ...quiet, litter: 50 };
  it('always stays within 0..999', () => {
    const disaster = {
      ...quiet,
      lostGuests: 500,
      unhappyPercent: 100,
      drowningCasualtyPenalty: 1_250,
      litter: 1000,
    };
    expect(computeParkRating(0, disaster)).toBe(0);
    expect(computeParkRating(2000, quiet)).toBeLessThanOrEqual(MAX_RATING);
  });

  it('gets worse with more lost guests beyond the first 25', () => {
    const base = 250;
    expect(computeParkRating(0, { ...quiet, lostGuests: 35 }, base)).toBe(
      computeParkRating(0, quiet, base) - 70,
    );
    expect(computeParkRating(0, { ...quiet, lostGuests: 125 }, base)).toBe(0);
  });

  it('gets worse with ride downtime and litter', () => {
    const base = 250;
    expect(computeParkRating(0, { ...quiet, rideDowntimePercent: 10 }, base)).toBe(
      computeParkRating(0, quiet, base) - 20,
    );
    expect(computeParkRating(0, { ...quiet, litter: 3 }, base)).toBe(
      computeParkRating(0, quiet, base) - 12,
    );
  });

  it('charges drowning casualties at 25 points each', () => {
    const one = { ...casualtyBase, drowningCasualtyPenalty: 25 };
    const two = { ...casualtyBase, drowningCasualtyPenalty: 50 };
    expect(computeParkRating(0, one)).toBe(computeParkRating(0, casualtyBase) - 25);
    expect(computeParkRating(0, two)).toBe(computeParkRating(0, casualtyBase) - 50);
  });

  it('charges an occupied ride crash at 200 points and caps all casualty penalties', () => {
    const oneCrash = { ...casualtyBase, fatalRideCrashPenalty: 200 };
    const twoCrashes = { ...casualtyBase, fatalRideCrashPenalty: 400 };
    const manyDrownings = { ...casualtyBase, drowningCasualtyPenalty: 2_500 };
    expect(computeParkRating(0, oneCrash)).toBe(computeParkRating(0, casualtyBase) - 200);
    expect(computeParkRating(0, twoCrashes)).toBe(
      Math.max(0, computeParkRating(0, casualtyBase) - 400),
    );
    expect(computeParkRating(0, manyDrownings)).toBe(
      Math.max(0, computeParkRating(0, casualtyBase) - 1000),
    );
  });

  it('subtracts the remaining per-type casualty penalty from park rating', () => {
    expect(
      computeParkRating(0, {
        ...casualtyBase,
        drowningCasualtyPenalty: 20,
      }),
    ).toBe(computeParkRating(0, casualtyBase) - 20);
  });
});

describe('park rating ride terms', () => {
  it('starts an empty park with a low rating', () => {
    expect(computeParkRating(0, createLedger().inputs)).toBe(250);
  });

  it('lets a developed park recover most of the rating lost at the start', () => {
    const developed = {
      ...quiet,
      openAttractionCount: 6,
      excitementTotal: 6 * IDEAL_EXCITEMENT,
      intensityTotal: 6 * IDEAL_INTENSITY,
      litter: 0,
      unhappyPercent: 0,
    };
    const rating = computeParkRating(250, developed);
    expect(rating).toBeGreaterThanOrEqual(700);
    expect(rating).toBeLessThan(MAX_RATING);
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

  it('keeps a modest starter park below the cap', () => {
    const starter = {
      ...quiet,
      openAttractionCount: 4,
      excitementTotal: 360 + 450 + 620 + 580,
      intensityTotal: 120 + 100 + 540 + 680,
    };
    expect(computeParkRating(60, starter)).toBeLessThan(MAX_RATING);
    expect(computeParkRating(60, starter)).toBeGreaterThan(200);
  });
});

describe('park rating happiness', () => {
  /** Litter keeps this park under the 999 cap, so penalties show in the score. */
  const below = { ...quiet, litter: 50 };
  const withHappiness = (unhappyPercent: number) => ({ ...below, unhappyPercent });

  it('charges the full 500 when no guest is happy', () => {
    expect(computeParkRating(0, below) - computeParkRating(0, withHappiness(100))).toBe(500);
  });

  it('charges 200 when half the guests are happy', () => {
    expect(computeParkRating(0, below) - computeParkRating(0, withHappiness(50))).toBe(200);
  });

  it('charges nothing once about 83% of guests are happy', () => {
    expect(computeParkRating(0, withHappiness(16))).toBe(computeParkRating(0, below));
    expect(computeParkRating(0, withHappiness(17))).toBe(computeParkRating(0, below) - 2);
  });

  it('charges nothing for a park with no guests', () => {
    expect(computeParkRating(0, withHappiness(0))).toBe(computeParkRating(0, below));
  });
});

describe('park rating difficulty', () => {
  it('starts from 600 instead of 700 when difficult rating is on', () => {
    const below = { ...quiet, litter: 50 };
    expect(computeParkRating(0, below, DIFFICULT_RATING_BASE)).toBe(
      computeParkRating(0, below) - 100,
    );
  });
});
