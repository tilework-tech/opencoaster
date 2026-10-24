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
  airtimeTicks: number;
}

export interface TrackedRideRatings {
  excitement: number;
  intensity: number;
  nausea: number;
}

const Q8 = 256;
const INTENSITY_THRESHOLDS_HUNDREDTHS = [1000, 1100, 1200, 1320, 1450] as const;
/** World units per height step; a track level is two steps, as in the spec's drop terms. */
const DROP_UNITS_PER_STEP = 32;
const LATERAL_WARNING_Q8 = 717;
const LATERAL_CRASH_RATING_Q8 = 794;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function hundredths(q8: number, coefficient: number): number {
  return Math.trunc((q8 * coefficient) / Q8);
}

/** Provisional shared tracked-ride terms; ride-type coefficients remain a rides-module concern. */
export function calculateTrackedRideRatings(metrics: RideTestMetrics): TrackedRideRatings {
  const positiveG = Math.max(0, metrics.maxVerticalGQ8);
  const negativeG = clamp(metrics.minVerticalGQ8, -640, 0);
  const lateralG = Math.max(0, metrics.maxLateralGQ8);
  const dropSteps = Math.trunc(metrics.highestDrop / DROP_UNITS_PER_STEP);
  let excitement =
    hundredths(positiveG, 8) +
    hundredths(-negativeG, 24) +
    hundredths(Math.min(lateralG, 384), 40) +
    11 * Math.min(9, metrics.dropCount) +
    Math.trunc((dropSteps * 49) / 100) +
    27 * Math.min(6, metrics.inversionCount) +
    Math.trunc(metrics.averageSpeed / Q8) +
    Math.trunc(metrics.maxSpeed / (2 * Q8)) +
    Math.min(250, Math.trunc(metrics.rideLength / 1024)) +
    Math.min(100, metrics.airtimeTicks * 2);
  let intensity =
    hundredths(positiveG, 80) +
    hundredths(Q8 - negativeG, 80) +
    hundredths(lateralG, 100) +
    14 * metrics.dropCount +
    Math.trunc((dropSteps * 98) / 100) +
    50 * metrics.inversionCount;
  let nausea =
    hundredths(positiveG, 26) +
    hundredths(Q8 - negativeG, 22) +
    hundredths(lateralG, 33) +
    10 * metrics.dropCount +
    Math.trunc((dropSteps * 16) / 100) +
    22 * metrics.inversionCount;

  if (lateralG > LATERAL_WARNING_Q8) {
    intensity += 375;
    nausea += 200;
  }
  if (lateralG > LATERAL_CRASH_RATING_Q8) {
    excitement = Math.trunc(excitement / 2);
    intensity += 850;
    nausea += 400;
  }
  for (const threshold of INTENSITY_THRESHOLDS_HUNDREDTHS) {
    if (intensity > threshold) excitement = Math.trunc((excitement * 75) / 100);
  }
  return {
    excitement: clamp(excitement, 0, 0xffff),
    intensity: clamp(intensity, 0, 0xffff),
    nausea: clamp(nausea, 0, 0xffff),
  };
}
