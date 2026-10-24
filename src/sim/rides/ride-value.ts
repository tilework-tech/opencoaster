import type { RideRatings } from './ride-operations';

/** Rating coefficients are written against this scale (see `rideValueUnits`). */
const VALUE_WEIGHT_SCALE = 32;
const VALUE_DIVISOR = 32_768;
/** One internal value unit is ten cents of ticket price. */
const CENTS_PER_VALUE_UNIT = 10;
/** A second open ride of the same type cuts every same-type ride's value to this percentage. */
export const SAME_TYPE_VALUE_PERCENT = 75;

/** Ride age bands, in months. Additive bands add value points; the rest scale by `percent`. */
export interface ValueAgeBand {
  fromMonths: number;
  /** Value points added for a young ride, when set. */
  bonus?: number;
  percent?: number;
}

/** The vanilla RCT2 schedule; the first two bands are additive, not multipliers. */
export const VALUE_AGE_BANDS: readonly ValueAgeBand[] = [
  { fromMonths: 0, bonus: 30 },
  { fromMonths: 5, bonus: 10 },
  { fromMonths: 13, percent: 100 },
  { fromMonths: 40, percent: 75 },
  { fromMonths: 64, percent: 56 },
  { fromMonths: 88, percent: 42 },
  { fromMonths: 104, percent: 32 },
  { fromMonths: 120, percent: 16 },
  { fromMonths: 128, percent: 8 },
  { fromMonths: 200, percent: 56 },
];

/**
 * Sum of each rating (in hundredths) times its ride-type coefficient, scaled by 32 and divided by
 * 32,768, with each term truncated.
 */
export function rideValueUnits(
  ratings: RideRatings,
  weights: readonly [number, number, number],
): number {
  const term = (rating: number, weight: number): number =>
    Math.floor((rating * weight * VALUE_WEIGHT_SCALE) / VALUE_DIVISOR);
  return (
    term(ratings.excitement, weights[0]) +
    term(ratings.intensity, weights[1]) +
    term(ratings.nausea, weights[2])
  );
}

export function rideAgeAdjustedValue(units: number, ageMonths: number): number {
  let band = VALUE_AGE_BANDS[0];
  for (const candidate of VALUE_AGE_BANDS) {
    if (ageMonths >= candidate.fromMonths) band = candidate;
  }
  if (band.bonus !== undefined) return units + band.bonus;
  return Math.floor((units * (band.percent ?? 100)) / 100);
}

export function valueUnitsToCents(units: number): number {
  return units * CENTS_PER_VALUE_UNIT;
}
