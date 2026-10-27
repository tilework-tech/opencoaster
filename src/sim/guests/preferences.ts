/**
 * Guest preferences are stored as bytes (0..255); ride ratings are in 1/100 units. These
 * helpers put both on the ride scale so choice code compares like with like.
 */

const INTENSITY_FLOOR = 150;
const INTENSITY_PER_STEP = 3;
/** How far above its preferred intensity a guest will still queue for a ride. */
const INTENSITY_MAX = 1000;
/** Maximum ride nausea for none, low, average and high tolerance. */
const NAUSEA_MAX = [300, 600, 800, 1000] as const;

/** Intensity a guest enjoys most, in 1/100 units (about 2.9 to 8.2 for the spawn range). */
export function preferredIntensityOf(preference: number): number {
  return INTENSITY_FLOOR + preference * INTENSITY_PER_STEP;
}

/** Highest ride intensity the guest will accept, in 1/100 units. */
export function intensityCeilingOf(preference: number, happiness: number): number {
  return Math.min(INTENSITY_MAX, preferredIntensityOf(preference)) + happiness;
}

/** Whether a ride with this nausea rating is too sickening for a guest in this state. */
export function exceedsNauseaLimit(
  rideNausea: number,
  guestNausea: number,
  tolerance: number,
): boolean {
  const bucket = Math.max(0, Math.min(3, Math.trunc(tolerance)));
  return rideNausea > NAUSEA_MAX[bucket] || (guestNausea > 160 && rideNausea >= 140);
}
