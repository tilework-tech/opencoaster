import type { System } from '../core/system';
import type { World } from '../core/world';
import { FeedbackDomain, reportFeedback } from '../core/feedback';
import { findRideTrain, removeRideTrains, spawnRideTrain } from '../vehicles/ride-trains';
import { VehicleState } from '../vehicles/vehicle-store';
import { abortCycle, breakDownRide } from './coaster';
import { recordRideTestMeasurements } from './ride-operations';
import { finishCycle } from './ride-system';
import { RidePhase, RideState } from './ride-store';
import { RIDE_CATALOG } from './ride-types';
import type { RideType, RideTypeDef } from './ride-types';
import { RideResult } from './ride-results';

/** A test lap that has not finished after five game minutes is abandoned. */
const TEST_TIMEOUT_TICKS = 12_000;

function clampRating(value: number): number {
  return Math.max(0, Math.min(0xffff, value));
}

function endTest(world: World, slot: number, rideId: number, result: RideResult): void {
  removeRideTrains(world, rideId);
  world.rides.cols.state[slot] = RideState.Closed;
  world.rides.cols.phase[slot] = RidePhase.Closed;
  reportFeedback(world.feedback, FeedbackDomain.Ride, result, rideId);
}

function completeTest(world: World, slot: number, rideId: number, train: number, def: RideTypeDef) {
  const v = world.vehicles.cols;
  const ride = world.rides.cols;
  const recorded = recordRideTestMeasurements(world, rideId, {
    durationTicks: Math.max(1, v.elapsedTicks[train]),
    maxSpeed: v.maxSpeed[train],
    maxPositiveG: Math.max(0, v.maxVerticalGQ8[train]),
    maxNegativeG: Math.min(0, v.minVerticalGQ8[train]),
    maxLateralG: v.maxLateralGQ8[train],
    dropCount: v.dropCount[train],
    highestDrop: v.highestDrop[train],
    inversionCount: v.inversionCount[train],
  });
  if (!recorded) {
    endTest(world, slot, rideId, RideResult.TestFailed);
    return;
  }
  ride.excitement[slot] = clampRating(v.excitement[train] + def.baseExcitement);
  ride.intensity[slot] = clampRating(v.intensity[train] + def.baseIntensity);
  ride.nausea[slot] = clampRating(v.nausea[train] + def.baseNausea);
  endTest(world, slot, rideId, RideResult.TestPassed);
}

function runTest(world: World, slot: number, rideId: number, def: RideTypeDef): void {
  const train = findRideTrain(world, rideId);
  if (train < 0) return endTest(world, slot, rideId, RideResult.TestFailed);
  const v = world.vehicles.cols;
  switch (v.state[train]) {
    case VehicleState.TestComplete:
      completeTest(world, slot, rideId, train, def);
      break;
    case VehicleState.Testing:
      if (v.elapsedTicks[train] > TEST_TIMEOUT_TICKS) {
        endTest(world, slot, rideId, RideResult.TestFailed);
      }
      break;
    default:
      endTest(world, slot, rideId, RideResult.TestFailed);
  }
}

/**
 * Dispatches the waiting train by the same rules as flat rides: minimum wait, then a full-enough
 * queue or the maximum wait. The guests leave the queue count here; the queue system seats the
 * `boarded` head-of-queue guests on the tick after the ride enters its loading phase.
 */
function dispatchIfReady(world: World, slot: number, train: number): void {
  const ride = world.rides.cols;
  const v = world.vehicles.cols;
  v.dispatchTicks[train] = 0;
  ride.phase[slot] = RidePhase.Waiting;
  if (ride.queueLength[slot] === 0) {
    ride.waitTicks[slot] = 0;
    return;
  }
  if (ride.waitTicks[slot] < 0xffff) ride.waitTicks[slot]++;
  const waited = ride.waitTicks[slot];
  if (waited < ride.minWaitTicks[slot]) return;
  const loaded = ride.queueLength[slot] * 255 >= ride.capacity[slot] * ride.loadThreshold[slot];
  if (!loaded && waited < ride.maxWaitTicks[slot]) return;

  const boarding = Math.min(ride.capacity[slot], ride.queueLength[slot]);
  ride.queueLength[slot] -= boarding;
  ride.boarded[slot] = boarding;
  v.passengers[train] = boarding;
  v.state[train] = VehicleState.Running;
  ride.waitTicks[slot] = 0;
  if (ride.loadTicks[slot] > 0) {
    ride.phase[slot] = RidePhase.Loading;
    ride.phaseTicks[slot] = ride.loadTicks[slot];
  } else {
    ride.phase[slot] = RidePhase.Running;
    ride.phaseTicks[slot] = ride.runTicks[slot];
  }
}

/** A lap takes well under a minute; a train still out after this many ticks is stuck. */
const OPERATING_TIMEOUT_TICKS = 20_000;

/** Tracks how long the train has been out; true once it is overdue. */
function trainOverdue(world: World, train: number): boolean {
  const v = world.vehicles.cols;
  if (v.dispatchTicks[train] < 0xffff) v.dispatchTicks[train]++;
  return v.dispatchTicks[train] >= OPERATING_TIMEOUT_TICKS;
}

function operate(world: World, slot: number, rideId: number): void {
  const ride = world.rides.cols;
  let train = findRideTrain(world, rideId);
  if (train < 0) {
    train = spawnRideTrain(world, rideId, VehicleState.Waiting, ride.capacity[slot]);
    if (train < 0) {
      ride.state[slot] = RideState.Closed;
      abortCycle(world, slot);
      reportFeedback(world.feedback, FeedbackDomain.Ride, RideResult.TrackIncomplete, rideId);
      return;
    }
    ride.phase[slot] = RidePhase.Waiting;
    ride.waitTicks[slot] = 0;
  }
  switch (world.vehicles.cols.state[train]) {
    case VehicleState.Waiting:
      dispatchIfReady(world, slot, train);
      break;
    case VehicleState.Running:
      ride.phase[slot] = RidePhase.Running;
      ride.phaseTicks[slot] = 0;
      if (trainOverdue(world, train)) breakDownRide(world, slot);
      break;
    default:
      breakDownRide(world, slot);
  }
}

/** A ride that is not open: its train finishes the lap, then is removed. */
function standDown(world: World, slot: number, rideId: number): void {
  const ride = world.rides.cols;
  const train = findRideTrain(world, rideId);
  if (train >= 0 && world.vehicles.cols.state[train] === VehicleState.Running) {
    ride.phase[slot] = RidePhase.Running;
    ride.phaseTicks[slot] = 0;
    if (trainOverdue(world, train)) breakDownRide(world, slot);
    return;
  }
  removeRideTrains(world, rideId);
  abortCycle(world, slot);
}

/** Handles a train that has come back to the station: guests get off and the cycle ends. */
function unloadIfArrived(world: World, slot: number, rideId: number): void {
  const ride = world.rides.cols;
  const train = findRideTrain(world, rideId);
  if (
    train < 0 ||
    ride.phase[slot] !== RidePhase.Running ||
    world.vehicles.cols.state[train] !== VehicleState.Waiting
  ) {
    return;
  }
  world.vehicles.cols.passengers[train] = 0;
  finishCycle(world, slot);
}

/**
 * Operates track-based rides: runs test laps and collects their ratings, then loads, dispatches
 * and unloads trains for open rides. Flat rides are handled by `rideSystem`.
 */
export const coasterSystem: System = {
  name: 'coasters',
  update(world) {
    const rides = world.rides;
    const ride = rides.cols;
    for (let slot = 0; slot < rides.count; slot++) {
      const def = RIDE_CATALOG[ride.typeId[slot] as RideType];
      if (!def?.usesTrack) continue;
      const rideId = rides.slotToId[slot];
      if (ride.state[slot] === RideState.Testing) {
        runTest(world, slot, rideId, def);
        continue;
      }
      unloadIfArrived(world, slot, rideId);
      if (ride.state[slot] === RideState.Open) operate(world, slot, rideId);
      else standDown(world, slot, rideId);
    }
  },
};
