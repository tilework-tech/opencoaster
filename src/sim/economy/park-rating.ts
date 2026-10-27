import type { EconomyInputs, ParkValueRide } from './ledger';

export const MAX_RATING = 999;
/** Rating before any factor is applied; a difficult-rating scenario starts lower. */
export const RATING_BASE = 1150;
export const DIFFICULT_RATING_BASE = 1050;
/** Guest-count factor: -150 with no guests, rising one point per 13 guests up to 2000 guests. */
const GUEST_TERM_MAX_GUESTS = 2000;
const GUEST_TERM_DIVISOR = 13;
const GUEST_TERM_FLOOR = 150;
/** Happiness factor: -500 with no happy guests, 0 once 250/300 (5/6) of guests are happy. */
const HAPPINESS_PENALTY_START = 500;
const HAPPINESS_OFFSET_CAP = 250;
/** Guests with happiness above this count as happy. */
export const HAPPY_ABOVE = 128;
/** Lost guests up to this number are forgiven; each further one costs LOST_GUEST_PENALTY. */
const LOST_GUESTS_FORGIVEN = 25;
const LOST_GUEST_PENALTY = 7;
/** Uptime factor: -200 plus two points per percent of average ride uptime. */
const UPTIME_PENALTY_START = 200;
/** Ride-mix factor: -100 with no rated rides, else up to -100 as averages leave the ideals below. */
const PROXIMITY_PENALTY_START = 100;
const PROXIMITY_CAP = 50;
/** Ride ratings are summed in eighths of a hundredth: a 3.68 excitement is 46. */
export const RATING_UNIT_DIVISOR = 8;
/** Ideal average excitement and intensity, in eighths. */
export const IDEAL_EXCITEMENT_EIGHTHS = 46;
export const IDEAL_INTENSITY_EIGHTHS = 65;
/** Variety factor: -200 until the capped excitement and intensity totals add up to 2000. */
const VARIETY_PENALTY_START = 200;
const VARIETY_TOTAL_CAP = 1000;
const VARIETY_DIVISOR = 10;
/** Litter at least this many ticks old counts against the rating; the cap is 150 pieces. */
export const LITTER_COUNTS_AFTER_TICKS = 7680;
const LITTER_CAP = 150;
const LITTER_PENALTY_EACH = 4;
const CASUALTY_PENALTY_CAP = 1000;
/** $7 per guest, expressed in cents. */
export const PARK_VALUE_PER_GUEST_CENTS = 700;

/** Community-derived per-type factors; exact RCT2 values remain an open compatibility question. */
export function rideValueContribution(rides: readonly ParkValueRide[]): number {
  let total = 0;
  for (const ride of rides) {
    const multiplier = Math.max(0, ride.ridersLast5Minutes + 4 * ride.typeBonus);
    total += ride.valueCents * multiplier;
  }
  return total;
}

export function parkValueOf(
  guests: number,
  inputs: EconomyInputs,
  rides?: readonly ParkValueRide[],
): number {
  return (
    (rides ? rideValueContribution(rides) : inputs.rideValue) + PARK_VALUE_PER_GUEST_CENTS * guests
  );
}

export interface ParkRatingBreakdown {
  base: number;
  guests: number;
  happiness: number;
  lostGuests: number;
  rideUptime: number;
  rideMix: number;
  rideVariety: number;
  litter: number;
  casualties: number;
  /** Sum of the factors before clamping to 0..999. */
  raw: number;
  total: number;
}

/** The named factors of a rating, in display order; `ratingFactorValues` lists them the same way. */
export const RATING_FACTOR_LABELS = [
  'Base',
  'Guest numbers',
  'Guest happiness',
  'Lost guests',
  'Ride uptime',
  'Ride excitement and intensity',
  'Ride variety',
  'Litter',
  'Casualties',
] as const;

export function ratingFactorValues(b: ParkRatingBreakdown): number[] {
  return [
    b.base,
    b.guests,
    b.happiness,
    b.lostGuests,
    b.rideUptime,
    b.rideMix,
    b.rideVariety,
    b.litter,
    b.casualties,
  ];
}

function rideMixFactor(inputs: EconomyInputs): number {
  const rated = inputs.ratedRideCount;
  if (rated <= 0) return -PROXIMITY_PENALTY_START;
  const excitement = Math.abs(
    Math.trunc(inputs.ratedExcitementEighths / rated) - IDEAL_EXCITEMENT_EIGHTHS,
  );
  const intensity = Math.abs(
    Math.trunc(inputs.ratedIntensityEighths / rated) - IDEAL_INTENSITY_EIGHTHS,
  );
  return (
    0 -
    Math.min(Math.trunc(excitement / 2), PROXIMITY_CAP) -
    Math.min(Math.trunc(intensity / 2), PROXIMITY_CAP)
  );
}

/**
 * Park rating as a sum of named factors. The factor shapes follow the original game's rating
 * (docs/mechanics/gap-audit.md, "Park rating formula"): a high base, then penalties for few or
 * unhappy guests, lost guests, ride downtime, rides far from the ideal excitement/intensity,
 * a thin ride roster, old litter and casualties. The ride factors count every rated ride,
 * open or not.
 */
export function parkRatingBreakdown(
  guests: number,
  inputs: EconomyInputs,
  base: number = RATING_BASE,
): ParkRatingBreakdown {
  const guestFactor =
    Math.trunc(Math.min(guests, GUEST_TERM_MAX_GUESTS) / GUEST_TERM_DIVISOR) - GUEST_TERM_FLOOR;
  const happyShare =
    guests > 0
      ? Math.min(HAPPINESS_OFFSET_CAP, Math.trunc((inputs.happyGuests * 300) / guests))
      : 0;
  const happiness = 2 * happyShare - HAPPINESS_PENALTY_START;
  const lostGuests = 0 - Math.max(0, inputs.lostGuests - LOST_GUESTS_FORGIVEN) * LOST_GUEST_PENALTY;
  const uptime = inputs.rideCount > 0 ? (100 - inputs.rideDowntimePercent) * 2 : 0;
  const rideUptime = uptime - UPTIME_PENALTY_START;
  const rideMix = rideMixFactor(inputs);
  const varietyTotal =
    Math.min(VARIETY_TOTAL_CAP, inputs.ratedExcitementEighths) +
    Math.min(VARIETY_TOTAL_CAP, inputs.ratedIntensityEighths);
  const rideVariety = Math.trunc(varietyTotal / VARIETY_DIVISOR) - VARIETY_PENALTY_START;
  const litter = 0 - Math.min(LITTER_CAP, inputs.litter) * LITTER_PENALTY_EACH;
  const typedCasualties = inputs.drowningCasualtyPenalty + inputs.fatalRideCrashPenalty;
  const casualties = 0 - Math.min(CASUALTY_PENALTY_CAP, typedCasualties + inputs.casualties * 100);
  const raw =
    base +
    guestFactor +
    happiness +
    lostGuests +
    rideUptime +
    rideMix +
    rideVariety +
    litter +
    casualties;
  return {
    base,
    guests: guestFactor,
    happiness,
    lostGuests,
    rideUptime,
    rideMix,
    rideVariety,
    litter,
    casualties,
    raw,
    total: Math.min(MAX_RATING, Math.max(0, raw)),
  };
}

export function computeParkRating(
  guests: number,
  inputs: EconomyInputs,
  base: number = RATING_BASE,
): number {
  return parkRatingBreakdown(guests, inputs, base).total;
}
