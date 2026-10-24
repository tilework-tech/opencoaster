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
} as const;
