import type { System } from '../core/system';
import type { World } from '../core/world';
import { FeedbackDomain, reportFeedback } from '../core/feedback';
import {
  MAX_TRAINS_PER_RIDE,
  carsForCapacity,
  findRideTrain,
  removeRideTrains,
  rideTrainSlots,
  spawnRideTrain,
} from '../vehicles/ride-trains';
import { MAX_RATING } from '../vehicles/vehicle-ratings';
import { VehicleState } from '../vehicles/vehicle-store';
import {
  maxTrainsOnTrack,
  stationDepartureClear,
  stationZoneClear,
  trainHeldAtBoundary,
} from '../vehicles/vehicle-system';
import type { VehicleTrack } from '../vehicles/vehicle-track';
import { abortCycle, breakDownRide, loadedTrips } from './coaster';
import { recordRideTestMeasurements } from './ride-operations';
import { completeCycle } from './ride-system';
import { seatQueuedGuests } from './queue-system';
import { RidePhase, RideState } from './ride-store';
import { RIDE_CATALOG } from './ride-types';
import type { RideType } from './ride-types';
import { RideResult } from './ride-results';

/** A test lap that has not finished after five game minutes is abandoned. */
export const TEST_TIMEOUT_TICKS = 12_000;

function clampRating(value: number): number {
  return Math.max(0, Math.min(MAX_RATING, value));
}

function endTest(world: World, slot: number, rideId: number, result: RideResult): void {
  removeRideTrains(world, rideId);
  world.rides.cols.state[slot] = RideState.Closed;
  world.rides.cols.phase[slot] = RidePhase.Closed;
  reportFeedback(world.feedback, FeedbackDomain.Ride, result, rideId);
}

function completeTest(world: World, slot: number, rideId: number, train: number) {
  const v = world.vehicles.cols;
  const ride = world.rides.cols;
  const recorded = recordRideTestMeasurements(world, rideId, {
    durationTicks: Math.max(1, v.elapsedTicks[train]),
    maxSpeed: v.maxSpeed[train],
    averageSpeed: v.averageSpeed[train],
    rideLength: v.rideLength[train],
    airtimeTicks: v.airtimeTicks[train],
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
  ride.excitement[slot] = clampRating(v.excitement[train]);
  ride.intensity[slot] = clampRating(v.intensity[train]);
  ride.nausea[slot] = clampRating(v.nausea[train]);
  endTest(world, slot, rideId, RideResult.TestPassed);
}

function runTest(world: World, slot: number, rideId: number): void {
  const train = findRideTrain(world, rideId);
  if (train < 0) return endTest(world, slot, rideId, RideResult.TestFailed);
  const v = world.vehicles.cols;
  switch (v.state[train]) {
    case VehicleState.TestComplete:
      completeTest(world, slot, rideId, train);
      break;
    case VehicleState.Testing:
      if (v.elapsedTicks[train] > TEST_TIMEOUT_TICKS) {
        endTest(world, slot, rideId, RideResult.TestFailed);
      }
      break;
    case VehicleState.Stalled:
      endTest(world, slot, rideId, RideResult.TestStalled);
      break;
    default:
      endTest(world, slot, rideId, RideResult.TestFailed);
  }
}

/** A lap takes well under a minute; a train still out after this many ticks is stuck. */
const OPERATING_TIMEOUT_TICKS = 20_000;

/** Tracks how long the train has been out; true once it is overdue. */
function trainOverdue(world: World, train: number): boolean {
  const v = world.vehicles.cols;
  const track = world.vehicleTracks?.get(v.rideId[train]);
  if (track && trainHeldAtBoundary(world, track, train)) return false;
  if (v.dispatchTicks[train] < 0xffff) v.dispatchTicks[train]++;
  return v.dispatchTicks[train] >= OPERATING_TIMEOUT_TICKS;
}

/**
 * Loads the train standing in the station: once the queue is long enough (or the maximum wait is
 * over) the riders are seated and counted off the queue; the train leaves after `loadTicks` when
 * the block zone ahead is clear.
 */
function loadAndDispatch(
  world: World,
  slot: number,
  train: number,
  track: VehicleTrack,
  trains: readonly number[],
): void {
  const ride = world.rides.cols;
  const v = world.vehicles.cols;
  if (v.passengers[train] === 0) {
    v.dispatchTicks[train] = 0;
    if (ride.queueLength[slot] === 0) {
      ride.waitTicks[slot] = 0;
      // An empty train makes room for a loaded one waiting behind it.
      const blocking = trains.some((t) => t !== train && v.passengers[t] > 0);
      if (blocking && stationDepartureClear(world, track, train)) {
        v.state[train] = VehicleState.Running;
      }
      return;
    }
    if (ride.waitTicks[slot] < 0xffff) ride.waitTicks[slot]++;
    const waited = ride.waitTicks[slot];
    if (waited < ride.minWaitTicks[slot]) return;
    const loaded = ride.queueLength[slot] * 255 >= ride.capacity[slot] * ride.loadThreshold[slot];
    if (!loaded && waited < ride.maxWaitTicks[slot]) return;

    const wanted = Math.min(ride.capacity[slot], ride.queueLength[slot]);
    const tag = ride.cyclesCompleted[slot] + loadedTrips(world, world.rides.slotToId[slot]);
    const seated = seatQueuedGuests(world, slot, wanted, tag);
    ride.queueLength[slot] -= wanted;
    ride.boarded[slot] += seated;
    v.passengers[train] = seated;
    ride.waitTicks[slot] = 0;
    return;
  }
  if (v.dispatchTicks[train] < 0xffff) v.dispatchTicks[train]++;
  if (
    v.dispatchTicks[train] >= ride.loadTicks[slot] &&
    stationDepartureClear(world, track, train)
  ) {
    v.state[train] = VehicleState.Running;
    v.dispatchTicks[train] = 0;
  }
}

/** Lets the riders off a train stopped in the station once `unloadTicks` have passed. */
function unloadTrain(world: World, slot: number, train: number): void {
  const ride = world.rides.cols;
  const v = world.vehicles.cols;
  if (v.dispatchTicks[train] < 0xffff) v.dispatchTicks[train]++;
  if (v.dispatchTicks[train] < ride.unloadTicks[slot]) return;
  const riders = v.passengers[train];
  v.passengers[train] = 0;
  v.state[train] = VehicleState.Waiting;
  v.dispatchTicks[train] = 0;
  if (riders > 0) completeCycle(world, slot, riders);
}

/** Phase shown for the ride as a whole, from where its trains are. */
function showPhase(world: World, slot: number, trains: readonly number[]): void {
  const ride = world.rides.cols;
  const v = world.vehicles.cols;
  if (ride.phase[slot] === RidePhase.Broken || ride.state[slot] === RideState.Broken) return;
  let phase: RidePhase = ride.state[slot] === RideState.Open ? RidePhase.Waiting : RidePhase.Closed;
  for (const train of trains) {
    const state = v.state[train];
    if (state === VehicleState.Running || state === VehicleState.Arriving) {
      phase = RidePhase.Running;
      break;
    }
    if (state === VehicleState.Unloading) phase = RidePhase.Unloading;
    else if (
      state === VehicleState.Waiting &&
      v.passengers[train] > 0 &&
      phase !== RidePhase.Unloading
    ) {
      phase = RidePhase.Loading;
    }
  }
  ride.phase[slot] = phase;
  ride.phaseTicks[slot] = 0;
}

/**
 * Trains the ride runs: the operator's count when set, else as many as it can. Block sections cap
 * both, since a section holds at most one train.
 */
function trainTarget(world: World, slot: number, track: VehicleTrack): number {
  const blocks = maxTrainsOnTrack(track);
  const requested = world.rides.cols.trainCount[slot];
  return Math.min(requested === 0 ? MAX_TRAINS_PER_RIDE : requested, blocks);
}

function operate(world: World, slot: number, rideId: number): void {
  const ride = world.rides.cols;
  const v = world.vehicles.cols;
  let trains = rideTrainSlots(world, rideId);
  if (trains.length === 0) {
    const first = spawnRideTrain(world, rideId, VehicleState.Waiting, ride.capacity[slot]);
    if (first < 0) {
      ride.state[slot] = RideState.Closed;
      abortCycle(world, slot);
      reportFeedback(world.feedback, FeedbackDomain.Ride, RideResult.TrackIncomplete, rideId);
      return;
    }
    ride.phase[slot] = RidePhase.Waiting;
    ride.waitTicks[slot] = 0;
    trains = [first];
  }
  const track = world.vehicleTracks?.get(rideId);
  if (track && trains.length < trainTarget(world, slot, track) && stationZoneClear(world, track)) {
    const next = spawnRideTrain(world, rideId, VehicleState.Waiting, ride.capacity[slot]);
    if (next >= 0) trains.push(next);
  }
  for (const train of trains) {
    switch (v.state[train]) {
      case VehicleState.Waiting:
        if (track) loadAndDispatch(world, slot, train, track, trains);
        break;
      case VehicleState.Running:
      case VehicleState.Arriving:
        if (trainOverdue(world, train)) return breakDownRide(world, slot);
        break;
      case VehicleState.Unloading:
        unloadTrain(world, slot, train);
        break;
      default:
        return breakDownRide(world, slot);
    }
    if (ride.state[slot] !== RideState.Open) return;
  }
  showPhase(world, slot, trains);
}

/** A ride that is not open: trains finish their lap and unload, then are removed. */
function standDown(world: World, slot: number, rideId: number): void {
  const v = world.vehicles.cols;
  const trains = rideTrainSlots(world, rideId);
  let out = false;
  for (const train of trains) {
    switch (v.state[train]) {
      case VehicleState.Running:
      case VehicleState.Arriving:
        out = true;
        if (trainOverdue(world, train)) return breakDownRide(world, slot);
        break;
      case VehicleState.Unloading:
        unloadTrain(world, slot, train);
        if (v.state[train] === VehicleState.Unloading) out = true;
        break;
      default:
        break;
    }
  }
  if (out) {
    showPhase(world, slot, trains);
    return;
  }
  abortCycle(world, slot);
  parkTrain(world, slot, rideId, trains);
}

/**
 * A tested, closed ride keeps one empty train standing in the station, built to the ride's
 * current car count; an untested ride has none.
 */
function parkTrain(world: World, slot: number, rideId: number, trains: readonly number[]): void {
  const ride = world.rides.cols;
  if (!ride.tested[slot]) {
    removeRideTrains(world, rideId);
    return;
  }
  const cars = carsForCapacity(ride.capacity[slot] > 0 ? ride.capacity[slot] : 16);
  const v = world.vehicles.cols;
  if (
    trains.length === 1 &&
    v.carCount[trains[0]] === cars &&
    v.state[trains[0]] === VehicleState.Waiting &&
    v.passengers[trains[0]] === 0
  ) {
    return;
  }
  removeRideTrains(world, rideId);
  spawnRideTrain(world, rideId, VehicleState.Waiting, ride.capacity[slot]);
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
      if (ride.state[slot] === RideState.Broken) continue;
      if (ride.state[slot] === RideState.Testing) {
        runTest(world, slot, rideId);
        continue;
      }
      if (ride.state[slot] === RideState.Open) operate(world, slot, rideId);
      else standDown(world, slot, rideId);
    }
  },
};
