/** Operating modes a ride type may offer. Each type lists only the modes that apply to it. */
export enum RideMode {
  /** Merry-go-round and twist: the ride spins for its configured run time. */
  Rotation = 1,
  /** Swinging ship. */
  Swing,
  ForwardRotation,
  BackwardRotation,
  /** Stalls and facilities: serve one customer at a time. */
  Shop,
  /** Track rides: trains circulate and dispatch from the station. */
  ContinuousCircuit,
}

/** Rating change a mode applies on top of the ride type's base ratings, in hundredths. */
export interface RideModeDef {
  mode: RideMode;
  name: string;
  excitement: number;
  intensity: number;
  nausea: number;
}

/** Fraction of capacity that must be queued before the station dispatches. */
export enum LoadTarget {
  Any = 0,
  Quarter,
  Half,
  ThreeQuarters,
  Full,
}

/**
 * Dispatch thresholds on the 0-255 scale stored per ride: floor(fraction x 255), so that a ride
 * dispatches at exactly that fraction of its capacity (255 waits for a full load).
 */
export const LOAD_TARGET_THRESHOLD: Readonly<Record<LoadTarget, number>> = {
  [LoadTarget.Any]: 0,
  [LoadTarget.Quarter]: 63,
  [LoadTarget.Half]: 127,
  [LoadTarget.ThreeQuarters]: 191,
  [LoadTarget.Full]: 255,
};

/**
 * Excitement gained by running the Ferris wheel backward, in hundredths. The original manual shows
 * the two directions rate differently without publishing the amount; the sign and size are an
 * OpenCoaster choice (docs/DECISIONS.md).
 */
export const FERRIS_BACKWARD_EXCITEMENT = 10;

export function modeDef(mode: RideMode, name: string, delta?: Partial<RideModeDef>): RideModeDef {
  return { mode, name, excitement: 0, intensity: 0, nausea: 0, ...delta };
}
