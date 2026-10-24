import { describe, expect, it } from 'vitest';
import { MAX_RATING, computeParkRating, parkValueOf } from './park-rating';
import { createLedger } from './ledger';

const quiet = createLedger().inputs;

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
