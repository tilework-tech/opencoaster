export const enum RideState {
  Closed = 0,
  Open = 1,
  Testing = 2,
  Broken = 3,
}

/** Per-ride-instance data. Static type definitions (names, costs) live in ride-types.ts. */
export const RIDE_SCHEMA = {
  typeId: Uint16Array,
  state: Uint8Array,
  entranceX: Int16Array,
  entranceY: Int16Array,
  /** Ratings in 1/100 units, computed from test runs. */
  excitement: Uint16Array,
  intensity: Uint16Array,
  nausea: Uint16Array,
  /** Ticket price in cents. */
  price: Uint16Array,
  queueLength: Uint16Array,
  reliability: Uint8Array,
  breakdownCounter: Uint16Array,
} as const;
