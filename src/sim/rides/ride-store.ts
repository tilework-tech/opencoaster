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

export const RIDER_HISTORY_WINDOWS = 60;
export const RIDER_HISTORY_WINDOW_TICKS = 200;
const riderHistorySchema = Object.fromEntries(
  Array.from({ length: RIDER_HISTORY_WINDOWS }, (_, index) => [
    `ridersWindow${String(index).padStart(2, '0')}`,
    Uint16Array,
  ]),
) as Record<string, Uint16ArrayConstructor>;

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
  ...riderHistorySchema,
  /** Quarter turns the ride's footprint is rotated by. */
  dir: Uint8Array,
  /** Guests who have joined the ride's line; the next joiner takes this as its queue position. */
  queueSerial: Uint32Array,
  /** Longest line (in guests) the operator allows; 0 means as long as the queue can hold. */
  queueLimit: Uint16Array,
  testAverageSpeed: Int32Array,
  testRideLength: Uint32Array,
  testAirtimeTicks: Uint32Array,
} as const;

/** Columns appended to the schema after each released save version, newest last. */
export const RIDE_COLUMNS_ADDED_IN_V10 = 5;

export function updateRideRiderWindow(world: {
  rides: { cols: unknown; count: number };
  tick: number;
}): void {
  if (world.tick % RIDER_HISTORY_WINDOW_TICKS !== 0) return;
  const window = Math.floor(world.tick / RIDER_HISTORY_WINDOW_TICKS) % RIDER_HISTORY_WINDOWS;
  const key = `ridersWindow${String(window).padStart(2, '0')}`;
  const column = (world.rides.cols as Record<string, Uint16Array>)[key];
  column.fill(0, 0, world.rides.count);
}

export function recordRideRiders(
  world: { rides: { cols: unknown }; tick: number },
  slot: number,
  count: number,
): void {
  const window = Math.floor(world.tick / RIDER_HISTORY_WINDOW_TICKS) % RIDER_HISTORY_WINDOWS;
  const key = `ridersWindow${String(window).padStart(2, '0')}`;
  const column = (world.rides.cols as Record<string, Uint16Array>)[key];
  column[slot] = Math.min(0xffff, column[slot] + count);
}

export function ridersInRecentWindow(
  world: { rides: { cols: unknown }; tick: number },
  slot: number,
): number {
  const current = Math.floor(world.tick / RIDER_HISTORY_WINDOW_TICKS) % RIDER_HISTORY_WINDOWS;
  const cols = world.rides.cols as Record<string, Uint16Array>;
  let total = 0;
  for (let offset = 0; offset < RIDER_HISTORY_WINDOWS; offset++) {
    const window = (current - offset + RIDER_HISTORY_WINDOWS) % RIDER_HISTORY_WINDOWS;
    total += cols[`ridersWindow${String(window).padStart(2, '0')}`][slot];
  }
  return total;
}
