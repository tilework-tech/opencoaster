export enum RideState {
  Closed = 0,
  Open = 1,
  Testing = 2,
  Broken = 3,
}

export enum RidePhase {
  Closed = 0,
  Waiting = 1,
  Running = 2,
  Unloading = 3,
  Broken = 4,
  Loading = 5,
}

/** Per-ride-instance state. Static tuning data lives in ride-types.ts. */
export const RIDE_SCHEMA = {
  typeId: Uint16Array,
  state: Uint8Array,
  phase: Uint8Array,
  rideX: Int16Array,
  rideY: Int16Array,
  entranceX: Int16Array,
  entranceY: Int16Array,
  exitX: Int16Array,
  exitY: Int16Array,
  entrancePlaced: Uint8Array,
  exitPlaced: Uint8Array,
  queueConnected: Uint8Array,
  queueLineTiles: Uint16Array,
  /** Ratings in 1/100 units. */
  excitement: Uint16Array,
  intensity: Uint16Array,
  nausea: Uint16Array,
  /** Ticket price in cents. */
  price: Uint16Array,
  /** Number of guests currently waiting in the queue. */
  queueLength: Uint16Array,
  capacity: Uint16Array,
  loadTicks: Uint16Array,
  runTicks: Uint16Array,
  unloadTicks: Uint16Array,
  minWaitTicks: Uint16Array,
  maxWaitTicks: Uint16Array,
  loadThreshold: Uint8Array,
  waitTicks: Uint16Array,
  phaseTicks: Uint16Array,
  boarded: Uint16Array,
  guestsServed: Uint32Array,
  cyclesCompleted: Uint32Array,
  createdTick: Uint32Array,
  ageMonths: Uint16Array,
  /** Whole-percent reliability shown to the player. */
  reliability: Uint8Array,
  breakdownCounter: Uint16Array,
  downtimeTicks: Uint32Array,
  /** Tick of the last mechanic inspection. */
  lastInspectionTick: Uint32Array,
  inspectionIntervalTicks: Uint32Array,
  tested: Uint8Array,
  testDurationTicks: Uint32Array,
  testMaxSpeed: Int32Array,
  testMaxPositiveG: Int32Array,
  testMaxNegativeG: Int32Array,
  testMaxLateralG: Int32Array,
  testDropCount: Uint16Array,
  testHighestDrop: Int32Array,
  testInversionCount: Uint16Array,
  /** Gross lifetime receipts in integer cents, capped at the stored integer range. */
  incomeCents: Uint32Array,
  /** Trains the operator asked for; 0 runs as many as the block sections allow. */
  trainCount: Uint8Array,
  /** Cars the operator asked for per train; 0 uses the ride type's default capacity. */
  carsPerTrain: Uint8Array,
  /**
   * Reliability on a 0-25,855 scale: 256 units per percent, so the fractional byte below the
   * whole percent in `reliability` is kept. `reliability` mirrors `floor(reliabilityRaw / 256)`.
   */
  reliabilityRaw: Uint16Array,
  /** `RideMode` the ride is set to. */
  mode: Uint8Array,
  /** `BreakdownReason` of the current failure, `None` while the ride is not broken down. */
  breakdownReason: Uint8Array,
  /** Consecutive ticks a mechanic has worked on the ride. */
  serviceTicks: Uint16Array,
  /** Tick of the latest mechanic work, to tell continuous work from separate visits. */
  serviceLastTick: Uint32Array,
} as const;

/** Columns appended to the schema after each released save version, newest last. */
export const RIDE_COLUMNS_ADDED_IN_V10 = 5;
