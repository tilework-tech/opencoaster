/** One row per ride vehicle (car/train segment). Positions are derived from track progress. */
export const VEHICLE_SCHEMA = {
  x: Int32Array,
  y: Int32Array,
  z: Int32Array,
  rideId: Uint16Array,
  /** Progress along the ride's track, fixed-point (see track/docs.md). */
  trackPos: Int32Array,
  speed: Int32Array,
  passengers: Uint8Array,
  state: Uint8Array,
} as const;
