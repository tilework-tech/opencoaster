/**
 * Guest preferences are stored as bytes (0..255); ride ratings are in 1/100 units. These
 * helpers put both on the ride scale so choice code compares like with like.
 */

const INTENSITY_FLOOR = 150;
const INTENSITY_PER_STEP = 3;
/** How far above its preferred intensity a guest will still queue for a ride. */
const INTENSITY_MARGIN = 150;
const NAUSEA_FLOOR = 300;
const NAUSEA_PER_STEP = 4;
/** A guest's own nausea byte counts this many hundredths against its limit. */
const NAUSEA_BYTE_WEIGHT = 4;

/** Intensity a guest enjoys most, in 1/100 units (about 2.9 to 8.2 for the spawn range). */
export function preferredIntensityOf(preference: number): number {
  return INTENSITY_FLOOR + preference * INTENSITY_PER_STEP;
}

/** Highest ride intensity the guest will accept, in 1/100 units. */
export function intensityCeilingOf(preference: number): number {
  return preferredIntensityOf(preference) + INTENSITY_MARGIN;
}

/** Whether a ride with this nausea rating is too sickening for a guest in this state. */
export function exceedsNauseaLimit(
  rideNausea: number,
  guestNausea: number,
  tolerance: number,
): boolean {
  return rideNausea + guestNausea * NAUSEA_BYTE_WEIGHT > NAUSEA_FLOOR + tolerance * NAUSEA_PER_STEP;
}
