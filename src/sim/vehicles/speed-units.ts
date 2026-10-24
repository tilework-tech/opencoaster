/**
 * Speed scale of the vehicle simulation: one world unit per tick is 5.1 km/h, the scale at which
 * the lateral-force table in docs/mechanics/track.md (maximum speed at 2.8 G per piece) is
 * reproduced by the force model. Speeds are Q8 world units per tick.
 */
const KMH_TENTHS_PER_UNIT_PER_TICK = 51;
const Q8 = 256;

export function kmhToSpeedQ8(kmh: number): number {
  return Math.round((kmh * 10 * Q8) / KMH_TENTHS_PER_UNIT_PER_TICK);
}

export function speedQ8ToKmh(speedQ8: number): number {
  return (speedQ8 * KMH_TENTHS_PER_UNIT_PER_TICK) / (10 * Q8);
}

/** Cars that are not attached to the track crash above these speeds at a crest or drop start. */
export const CREST_CRASH_SPEED_Q8 = kmhToSpeedQ8(50);
export const DROP_CRASH_SPEED_Q8 = kmhToSpeedQ8(64);
/** Two trains of one ride crash when they meet with at least this combined speed. */
export const COLLISION_SPEED_Q8 = kmhToSpeedQ8(48);
