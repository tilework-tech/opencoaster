/** Outcome of a ride command or ride event, published as `FeedbackDomain.Ride`. */
export const enum RideResult {
  Ok = 0,
  NoSuchRide = 1,
  NotTrackRide = 2,
  /** The track is not a closed circuit with a station. */
  TrackIncomplete = 3,
  /** A cycle, test run or open ride prevents the change. */
  Busy = 4,
  Broken = 5,
  NotTested = 6,
  NoEntrance = 7,
  NoExit = 8,
  NoQueue = 9,
  NotAdjacentToStation = 10,
  NotOwned = 11,
  Blocked = 12,
  InsufficientFunds = 13,
  OutOfBounds = 14,
  /** The test train crashed or did not finish in time. */
  TestFailed = 15,
  TestPassed = 16,
  /** The test train stopped part way round the circuit and could not continue. */
  TestStalled = 17,
  ResearchRequired = 18,
  /** The ground under the footprint is too uneven for the ride's supports. */
  TooSteep = 19,
  /** Part of the footprint is under water. */
  Underwater = 20,
}
