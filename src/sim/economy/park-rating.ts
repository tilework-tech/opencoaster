import type { EconomyInputs } from './ledger';

export const MAX_RATING = 999;
/** Starting rating before penalties; a difficult-rating scenario starts lower. */
export const RATING_BASE = 1150;
export const DIFFICULT_RATING_BASE = 1050;
/** Happiness penalty when no guest is happy; each happiness point removed lowers it by 2. */
const HAPPINESS_PENALTY_START = 500;
/** Happy share, in 300ths of the guest count, beyond which the happiness penalty is fully removed. */
const HAPPINESS_OFFSET_CAP = 250;
/** $7 per guest, expressed in cents. */
export const PARK_VALUE_PER_GUEST_CENTS = 700;

/** Average ride ratings, in 1/100 units, that earn no proximity penalty. */
export const IDEAL_EXCITEMENT = 368;
export const IDEAL_INTENSITY = 520;
/** Each hundredth of distance from the ideal average costs 1/PROXIMITY_DIVISOR rating, up to the cap. */
const PROXIMITY_DIVISOR = 4;
const PROXIMITY_CAP = 50;
/** Total excitement (and, separately, intensity) at which the variety penalty disappears: 80.00. */
export const VARIETY_TOTAL = 8000;
const VARIETY_CAP = 100;

export function parkValueOf(guests: number, inputs: EconomyInputs): number {
  return inputs.rideValue + PARK_VALUE_PER_GUEST_CENTS * guests;
}

function proximityPenalty(total: number, count: number, ideal: number): number {
  if (count === 0) return PROXIMITY_CAP;
  const average = Math.floor(total / count);
  return Math.min(PROXIMITY_CAP, Math.floor(Math.abs(average - ideal) / PROXIMITY_DIVISOR));
}

function varietyPenalty(total: number): number {
  return Math.max(0, VARIETY_CAP - Math.floor((total * VARIETY_CAP) / VARIETY_TOTAL));
}

/**
 * Community-derived rating formula (economy.md). The guest term follows the guide's stated
 * range (-150 at 0 guests to about +3 at 2000). The ride terms penalise a park whose open
 * attractions average far from the ideal excitement and intensity, and a park whose attractions
 * add up to too little excitement or intensity overall. Constants are tunable (docs/BALANCE.md)
 * and unverified against the original game.
 */
export function computeParkRating(
  guests: number,
  inputs: EconomyInputs,
  base: number = RATING_BASE,
): number {
  const guestTerm = Math.floor(Math.min(guests, 2000) / 13) - 150;
  const happyThirds = 3 * (100 - inputs.unhappyPercent);
  const happinessPenalty =
    HAPPINESS_PENALTY_START - 2 * Math.min(HAPPINESS_OFFSET_CAP, happyThirds);
  const lostPenalty = Math.max(0, inputs.lostGuests - 25) * 7;
  const uptimePenalty = Math.min(200, inputs.rideDowntimePercent * 2);
  const litterPenalty = Math.min(600, inputs.litter * 4);
  const casualtyPenalty = Math.min(1000, inputs.casualties * 100);
  const count = inputs.openAttractionCount;
  const ridePenalty =
    proximityPenalty(inputs.excitementTotal, count, IDEAL_EXCITEMENT) +
    proximityPenalty(inputs.intensityTotal, count, IDEAL_INTENSITY) +
    varietyPenalty(inputs.excitementTotal) +
    varietyPenalty(inputs.intensityTotal);
  const raw =
    base +
    guestTerm -
    happinessPenalty -
    lostPenalty -
    uptimePenalty -
    litterPenalty -
    casualtyPenalty -
    ridePenalty;
  return Math.min(MAX_RATING, Math.max(0, raw));
}
