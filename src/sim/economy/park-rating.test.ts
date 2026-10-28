import { describe, expect, it } from 'vitest';
import {
  DIFFICULT_RATING_BASE,
  MAX_RATING,
  RATING_BASE,
  computeParkRating,
  parkRatingBreakdown,
  parkValueOf,
} from './park-rating';
import { createLedger } from './ledger';
import type { EconomyInputs } from './ledger';

/**
 * Ten tested rides averaging excitement 3.68 and intensity 5.20 (46 and 65 eighths each), all
 * working, with every guest happy and 100 old pieces of litter holding the rating under the cap.
 * Expected totals are worked by hand from the RCT2 rating factors:
 * 1150 + 3 (2000 guests) + 0 (happy) + 0 (lost) + 0 (uptime) + 0 (ideal mix)
 * + (460 + 650) / 10 - 200 (variety) - 400 (litter) = 664.
 */
const GUESTS = 2000;
const park = (overrides: Partial<EconomyInputs> = {}): EconomyInputs => ({
  ...createLedger().inputs,
  happyGuests: GUESTS,
  rideCount: 10,
  ratedRideCount: 10,
  ratedExcitementEighths: 460,
  ratedIntensityEighths: 650,
  litter: 100,
  ...overrides,
});

describe('park value', () => {
  it('adds $7 per guest to the ride value total', () => {
    expect(parkValueOf(10, { ...park(), rideValue: 5_000 })).toBe(5_000 + 10 * 700);
  });

  it('includes recent riders and a ride-type bonus in each ride contribution', () => {
    expect(
      parkValueOf(0, park(), [{ valueCents: 10_000, ridersLast5Minutes: 20, typeBonus: 30 }]),
    ).toBe(1_400_000);
  });
});

describe('park rating factors', () => {
  it('starts from 1150, or 1050 in a difficult-rating scenario', () => {
    expect(RATING_BASE).toBe(1150);
    expect(DIFFICULT_RATING_BASE).toBe(1050);
    expect(computeParkRating(GUESTS, park(), DIFFICULT_RATING_BASE)).toBe(564);
  });

  it('adds up to the hand-worked total and names each factor', () => {
    expect(parkRatingBreakdown(GUESTS, park())).toEqual({
      base: 1150,
      guests: 3,
      happiness: 0,
      lostGuests: 0,
      rideUptime: 0,
      rideMix: 0,
      rideVariety: -89,
      litter: -400,
      casualties: 0,
      raw: 664,
      total: 664,
    });
  });

  it('rates a park with no guests and no rides at zero', () => {
    const empty = parkRatingBreakdown(0, createLedger().inputs);
    expect(empty).toMatchObject({
      guests: -150,
      happiness: -500,
      rideUptime: -200,
      rideMix: -100,
      rideVariety: -200,
      raw: 0,
      total: 0,
    });
  });

  it('keeps the rating within 0..999', () => {
    expect(computeParkRating(GUESTS, park({ litter: 0 }))).toBe(MAX_RATING);
    expect(computeParkRating(GUESTS, park({ lostGuests: 500 }))).toBe(0);
  });

  it('adds a point per 13 guests, from -150 with none to +3 at 2000 and beyond', () => {
    const rating = (guests: number) => parkRatingBreakdown(guests, park()).guests;
    expect(rating(0)).toBe(-150);
    expect(rating(130)).toBe(-140);
    expect(rating(2000)).toBe(3);
    expect(rating(9000)).toBe(3);
  });

  it('scores happiness from -500 with no happy guests to 0 at five sixths happy', () => {
    const happiness = (happy: number) =>
      parkRatingBreakdown(GUESTS, park({ happyGuests: happy })).happiness;
    expect(happiness(0)).toBe(-500);
    expect(happiness(1000)).toBe(-200);
    expect(happiness(1667)).toBe(0);
    expect(happiness(2000)).toBe(0);
    expect(parkRatingBreakdown(0, park({ happyGuests: 0 })).happiness).toBe(-500);
  });

  it('forgives 25 lost guests and charges 7 points for each one after', () => {
    const lost = (n: number) => parkRatingBreakdown(GUESTS, park({ lostGuests: n })).lostGuests;
    expect(lost(25)).toBe(0);
    expect(lost(35)).toBe(-70);
  });

  it('charges two points per percent of average ride downtime', () => {
    const uptime = (percent: number) =>
      parkRatingBreakdown(GUESTS, park({ rideDowntimePercent: percent })).rideUptime;
    expect(uptime(0)).toBe(0);
    expect(uptime(10)).toBe(-20);
    expect(uptime(100)).toBe(-200);
  });

  it('charges the full 300 when no ride has been rated', () => {
    const unrated = parkRatingBreakdown(
      GUESTS,
      park({ ratedRideCount: 0, ratedExcitementEighths: 0, ratedIntensityEighths: 0 }),
    );
    expect(unrated.rideMix).toBe(-100);
    expect(unrated.rideVariety).toBe(-200);
  });

  it('penalises half the distance of the average rating from 46 and 65 eighths, up to 50 each', () => {
    const mix = (excitement: number, intensity: number) =>
      parkRatingBreakdown(
        GUESTS,
        park({ ratedExcitementEighths: excitement, ratedIntensityEighths: intensity }),
      ).rideMix;
    expect(mix(660, 650)).toBe(-10);
    expect(mix(260, 650)).toBe(-10);
    expect(mix(460, 850)).toBe(-10);
    expect(mix(2000, 650)).toBe(-50);
    expect(mix(2000, 2000)).toBe(-100);
    expect(mix(460, 650)).toBe(0);
  });

  it('forgives a thin ride roster only as capped excitement and intensity totals reach 2000', () => {
    const variety = (excitement: number, intensity: number) =>
      parkRatingBreakdown(
        GUESTS,
        park({ ratedExcitementEighths: excitement, ratedIntensityEighths: intensity }),
      ).rideVariety;
    expect(variety(460, 650)).toBe(-89);
    expect(variety(1000, 1000)).toBe(0);
    expect(variety(5000, 5000)).toBe(0);
    expect(variety(5000, 0)).toBe(-100);
  });

  it('charges 4 points per piece of old litter, up to 150 pieces', () => {
    const litter = (n: number) => parkRatingBreakdown(GUESTS, park({ litter: n })).litter;
    expect(litter(0)).toBe(0);
    expect(litter(3)).toBe(-12);
    expect(litter(150)).toBe(-600);
    expect(litter(900)).toBe(-600);
  });
});

describe('park rating casualties', () => {
  it('charges drowning casualties at 25 points each', () => {
    expect(computeParkRating(GUESTS, park({ drowningCasualtyPenalty: 50 }))).toBe(664 - 50);
  });

  it('charges an occupied ride crash at 200 points and caps all casualty penalties', () => {
    expect(computeParkRating(GUESTS, park({ fatalRideCrashPenalty: 200 }))).toBe(664 - 200);
    expect(parkRatingBreakdown(GUESTS, park({ drowningCasualtyPenalty: 2_500 })).casualties).toBe(
      -1000,
    );
  });
});
