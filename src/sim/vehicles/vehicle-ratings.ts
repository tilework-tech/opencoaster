/** Counts of the track elements that feed the turn, helix and shelter rating terms. */
export interface TrackElementStats {
  /** Unbanked level turns by element count: 1, 2, 3 or more. */
  flatTurns: readonly number[];
  /** Banked level turns by element count: 1, 2, 3 or more. */
  bankedTurns: readonly number[];
  /** Turns on a slope by element count: 1, 2, 3, 4 or more. */
  slopedTurns: readonly number[];
  helices: number;
  /** Track length under the terrain, in SHELTERED_UNIT_WORLD steps. */
  shelteredLength: number;
  /** Separate runs of sheltered track. */
  shelteredSections: number;
  /** Banked or inverting pieces inside sheltered track. */
  shelteredRollingPieces: number;
}

export interface RideTestMetrics {
  maxSpeed: number;
  averageSpeed: number;
  dropCount: number;
  highestDrop: number;
  inversionCount: number;
  maxVerticalGQ8: number;
  minVerticalGQ8: number;
  maxLateralGQ8: number;
  rideLength: number;
  /** Ticks at or below zero vertical G; one tick is one air-time unit. */
  airtimeTicks: number;
  elements?: TrackElementStats;
  /** Scenery items within SCENERY_RADIUS_TILES of the station. */
  sceneryItems?: number;
  undergroundStation?: boolean;
}

export interface TrackedRideRatings {
  excitement: number;
  intensity: number;
  nausea: number;
}

export interface RatingTriple {
  excitement: number;
  intensity: number;
  nausea: number;
}

/**
 * Minimum test-run results; a ride that falls short has all three ratings divided by
 * `RatingProfile.requirementDivisor` once per unmet requirement. Zero or absent means no requirement.
 * The per-type values are tunable: no source lists them.
 */
export interface RatingRequirements {
  /** World units of track travelled. */
  minLength?: number;
  /** World units of the highest drop. */
  minDropHeight?: number;
  minMaxSpeedQ8?: number;
  minDropCount?: number;
  /** Q8 G, negative: the test run must reach at least this much negative vertical G. */
  minNegativeGQ8?: number;
  minLateralGQ8?: number;
  minInversions?: number;
  minShelteredLength?: number;
}

/** Ride-type rating data applied around the shared track terms. All values are tunable. */
export interface RatingProfile {
  /** Hundredths added before bonuses and penalties. */
  base: RatingTriple;
  /** Percent applied after the penalties (100 = unchanged). */
  multiplierPercent: RatingTriple;
  requirements?: RatingRequirements;
  requirementDivisor?: number;
  /** Rides where long air time is unpleasant: air time beyond LIMITED_AIR_TIME costs excitement. */
  limitedAirTime?: boolean;
}

export const NEUTRAL_PROFILE: RatingProfile = {
  base: { excitement: 0, intensity: 0, nausea: 0 },
  multiplierPercent: { excitement: 100, intensity: 100, nausea: 100 },
};

const Q8 = 256;
export const MAX_RATING = 32767;
const INTENSITY_THRESHOLDS_HUNDREDTHS = [1000, 1100, 1200, 1320, 1450] as const;
/**
 * World units per height step; a track level is two steps (docs/mechanics/track.md). The highest
 * drop enters the drop term in steps; see docs/DECISIONS.md "Drop term unit".
 */
export const DROP_UNITS_PER_STEP = 32;
const LATERAL_WARNING_Q8 = 717;
const LATERAL_CRASH_RATING_Q8 = 794;

/** Air time (ticks) is counted up to this cap in every air-time term. */
const AIR_TIME_CAP = 200;
/** Limited-air-time rides lose excitement for air time beyond this many ticks. */
const LIMITED_AIR_TIME = 96;

export const SCENERY_RADIUS_TILES = 5;
const SCENERY_CAP = 47;
const SCENERY_PER_ITEM = 5;
const UNDERGROUND_STATION_EXCITEMENT = 40;

/** World units per sheltered-length step: a quarter tile. Tunable; the source gives no unit. */
export const SHELTERED_UNIT_WORLD = 64;
const SHELTERED_EXCITEMENT_PER_UNIT = 0.14;
const SHELTERED_EXCITEMENT_CAP = 1000;
const SHELTERED_INTENSITY_PER_UNIT = 0.15;
const SHELTERED_INTENSITY_CAP = 2000;
const SHELTERED_NAUSEA_PER_UNIT = 0.25;
const SHELTERED_NAUSEA_CAP = 1000;
const SHELTERED_ROLLING_EXCITEMENT = 20;
const SHELTERED_ROLLING_NAUSEA = 15;
const SHELTERED_SECTION_EXCITEMENT = 11.82;
const SHELTERED_SECTION_CAP = 11;

const HELIX_EXCITEMENT = 3.89;
const HELIX_EXCITEMENT_CAP = 9;
const HELIX_INTENSITY = 2.27;
const HELIX_INTENSITY_CAP = 11;
const HELIX_NAUSEA = 20;
const HELIX_NAUSEA_FREE = 5;
const HELIX_NAUSEA_CAP = 10;

/** Hundredths per turn by element count (1, 2, 3+). */
const FLAT_TURN = {
  excitement: [0.968, 3, 2.5],
  intensity: [0.323, 0.75, 1.25],
  nausea: [0.645, 3.125, 5],
} as const;
const BANKED_TURN = {
  excitement: [1.129, 3.75, 3.75],
  intensity: [0.323, 0.75, 1.25],
  nausea: [0.742, 3.125, 5],
} as const;
/** Sloped turns by element count (1, 2, 3, 4+): hundredths per turn and the most turns counted. */
const SLOPED_TURN = {
  excitement: { each: [2.857, 3.667, 4.167, 7.5], cap: [7, 6, 6, 4] },
  nausea: { each: [0, 0, 0, 7.5], cap: [0, 0, 0, 8] },
} as const;

/** Divisor per unmet requirement when a profile names none. Tunable. */
const DEFAULT_REQUIREMENT_DIVISOR = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function hundredths(q8: number, coefficient: number): number {
  return Math.trunc((q8 * coefficient) / Q8);
}

function weighted(counts: readonly number[], each: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < each.length; i++) total += (counts[i] ?? 0) * each[i];
  return total;
}

function turnTerms(elements: TrackElementStats): RatingTriple {
  const sloped = (field: 'excitement' | 'nausea'): number => {
    const { each, cap } = SLOPED_TURN[field];
    let total = 0;
    for (let i = 0; i < each.length; i++) {
      total += Math.min(elements.slopedTurns[i] ?? 0, cap[i]) * each[i];
    }
    return total;
  };
  return {
    excitement:
      weighted(elements.flatTurns, FLAT_TURN.excitement) +
      weighted(elements.bankedTurns, BANKED_TURN.excitement) +
      sloped('excitement'),
    intensity:
      weighted(elements.flatTurns, FLAT_TURN.intensity) +
      weighted(elements.bankedTurns, BANKED_TURN.intensity),
    nausea:
      weighted(elements.flatTurns, FLAT_TURN.nausea) +
      weighted(elements.bankedTurns, BANKED_TURN.nausea) +
      sloped('nausea'),
  };
}

function helixTerms(helices: number): RatingTriple {
  return {
    excitement: Math.min(helices, HELIX_EXCITEMENT_CAP) * HELIX_EXCITEMENT,
    intensity: Math.min(helices, HELIX_INTENSITY_CAP) * HELIX_INTENSITY,
    nausea: Math.max(0, Math.min(helices, HELIX_NAUSEA_CAP) - HELIX_NAUSEA_FREE) * HELIX_NAUSEA,
  };
}

function shelterTerms(elements: TrackElementStats): RatingTriple {
  return {
    excitement:
      Math.min(elements.shelteredLength, SHELTERED_EXCITEMENT_CAP) * SHELTERED_EXCITEMENT_PER_UNIT +
      elements.shelteredRollingPieces * SHELTERED_ROLLING_EXCITEMENT +
      Math.min(elements.shelteredSections, SHELTERED_SECTION_CAP) * SHELTERED_SECTION_EXCITEMENT,
    intensity:
      Math.min(elements.shelteredLength, SHELTERED_INTENSITY_CAP) * SHELTERED_INTENSITY_PER_UNIT,
    nausea:
      Math.min(elements.shelteredLength, SHELTERED_NAUSEA_CAP) * SHELTERED_NAUSEA_PER_UNIT +
      elements.shelteredRollingPieces * SHELTERED_ROLLING_NAUSEA,
  };
}

/** How many of the profile's requirements the test run missed. */
export function unmetRequirements(
  metrics: RideTestMetrics,
  requirements: RatingRequirements | undefined,
): number {
  if (!requirements) return 0;
  let unmet = 0;
  if (requirements.minLength && metrics.rideLength / Q8 < requirements.minLength) unmet++;
  if (requirements.minDropHeight && metrics.highestDrop < requirements.minDropHeight) unmet++;
  if (requirements.minMaxSpeedQ8 && metrics.maxSpeed < requirements.minMaxSpeedQ8) unmet++;
  if (requirements.minDropCount && metrics.dropCount < requirements.minDropCount) unmet++;
  if (requirements.minNegativeGQ8 && metrics.minVerticalGQ8 > requirements.minNegativeGQ8) unmet++;
  if (requirements.minLateralGQ8 && metrics.maxLateralGQ8 < requirements.minLateralGQ8) unmet++;
  if (requirements.minInversions && metrics.inversionCount < requirements.minInversions) unmet++;
  if (
    requirements.minShelteredLength &&
    (metrics.elements?.shelteredLength ?? 0) < requirements.minShelteredLength
  ) {
    unmet++;
  }
  return unmet;
}

/**
 * Tracked-ride ratings in hundredths. Order: base values and track terms, requirement divisions,
 * the intensity penalty on excitement, ride-type multipliers, air-time terms, clamp.
 */
export function calculateTrackedRideRatings(
  metrics: RideTestMetrics,
  profile: RatingProfile = NEUTRAL_PROFILE,
): TrackedRideRatings {
  const positiveG = Math.max(0, metrics.maxVerticalGQ8);
  const negativeG = clamp(metrics.minVerticalGQ8, -640, 0);
  const lateralG = Math.max(0, metrics.maxLateralGQ8);
  const dropSteps = metrics.highestDrop / DROP_UNITS_PER_STEP;
  const elements = metrics.elements;
  const turns = elements ? turnTerms(elements) : { excitement: 0, intensity: 0, nausea: 0 };
  const helices = elements
    ? helixTerms(elements.helices)
    : { excitement: 0, intensity: 0, nausea: 0 };
  const shelter = elements ? shelterTerms(elements) : { excitement: 0, intensity: 0, nausea: 0 };
  const scenery = metrics.undergroundStation
    ? UNDERGROUND_STATION_EXCITEMENT
    : Math.min(SCENERY_CAP, metrics.sceneryItems ?? 0) * SCENERY_PER_ITEM;

  let excitement =
    profile.base.excitement +
    hundredths(positiveG, 8) +
    hundredths(-negativeG, 24) +
    hundredths(Math.min(lateralG, 384), 40) +
    11 * Math.min(9, metrics.dropCount) +
    Math.trunc(dropSteps * 0.49) +
    27 * Math.min(6, metrics.inversionCount) +
    Math.trunc(metrics.averageSpeed / Q8) +
    Math.trunc(metrics.maxSpeed / (2 * Q8)) +
    Math.min(250, Math.trunc(metrics.rideLength / 1024)) +
    Math.trunc(turns.excitement + helices.excitement + shelter.excitement + scenery);
  let intensity =
    profile.base.intensity +
    hundredths(positiveG, 80) +
    hundredths(Q8 - negativeG, 80) +
    hundredths(lateralG, 100) +
    14 * metrics.dropCount +
    Math.trunc(dropSteps * 0.98) +
    50 * metrics.inversionCount +
    Math.trunc(turns.intensity + helices.intensity + shelter.intensity);
  let nausea =
    profile.base.nausea +
    hundredths(positiveG, 26) +
    hundredths(Q8 - negativeG, 22) +
    hundredths(lateralG, 33) +
    10 * metrics.dropCount +
    Math.trunc(dropSteps * 0.16) +
    22 * metrics.inversionCount +
    Math.trunc(turns.nausea + helices.nausea + shelter.nausea);

  if (lateralG > LATERAL_WARNING_Q8) {
    intensity += 375;
    nausea += 200;
  }
  if (lateralG > LATERAL_CRASH_RATING_Q8) {
    excitement = Math.trunc(excitement / 2);
    intensity += 850;
    nausea += 400;
  }

  const divisor = profile.requirementDivisor ?? DEFAULT_REQUIREMENT_DIVISOR;
  for (let unmet = unmetRequirements(metrics, profile.requirements); unmet > 0; unmet--) {
    excitement = Math.trunc(excitement / divisor);
    intensity = Math.trunc(intensity / divisor);
    nausea = Math.trunc(nausea / divisor);
  }

  for (const threshold of INTENSITY_THRESHOLDS_HUNDREDTHS) {
    if (intensity > threshold) excitement = Math.trunc((excitement * 75) / 100);
  }

  excitement = Math.trunc((excitement * profile.multiplierPercent.excitement) / 100);
  intensity = Math.trunc((intensity * profile.multiplierPercent.intensity) / 100);
  nausea = Math.trunc((nausea * profile.multiplierPercent.nausea) / 100);

  const air = Math.min(AIR_TIME_CAP, Math.max(0, metrics.airtimeTicks));
  if (profile.limitedAirTime) {
    if (air > LIMITED_AIR_TIME) excitement -= Math.trunc((air - LIMITED_AIR_TIME) / 8);
  } else {
    excitement += Math.trunc(air / 8);
  }
  nausea += Math.trunc(air / 16);

  return {
    excitement: clamp(excitement, 0, MAX_RATING),
    intensity: clamp(intensity, 0, MAX_RATING),
    nausea: clamp(nausea, 0, MAX_RATING),
  };
}
