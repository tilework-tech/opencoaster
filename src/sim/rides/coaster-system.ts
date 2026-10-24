import type { System } from '../core/system';
import type { World } from '../core/world';
import { FeedbackDomain, reportFeedback } from '../core/feedback';
import { findRideTrain, removeRideTrains, spawnRideTrain } from '../vehicles/ride-trains';
import { VehicleState } from '../vehicles/vehicle-store';
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

/** Moves queued guests onto the waiting train and dispatches it by the ride's operating rules. */
function loadAndDispatch(world: World, slot: number, train: number): void {
  const ride = world.rides.cols;
  const v = world.vehicles.cols;
  const boarding = Math.min(v.capacity[train] - v.passengers[train], ride.queueLength[slot]);
  v.passengers[train] += boarding;
  ride.queueLength[slot] -= boarding;
  ride.boarded[slot] = v.passengers[train];
  v.dispatchTicks[train] = 0;
  if (v.passengers[train] === 0) {
    ride.waitTicks[slot] = 0;
    ride.phase[slot] = RidePhase.Waiting;
    return;
  }
  ride.phase[slot] = RidePhase.Loading;
  if (ride.waitTicks[slot] < 0xffff) ride.waitTicks[slot]++;
  const waited = ride.waitTicks[slot];
  const loaded = v.passengers[train] * 255 >= v.capacity[train] * ride.loadThreshold[slot];
  if (waited >= ride.minWaitTicks[slot] && (loaded || waited >= ride.maxWaitTicks[slot])) {
    v.state[train] = VehicleState.Running;
    ride.phase[slot] = RidePhase.Running;
    ride.waitTicks[slot] = 0;
  }
}

function operate(world: World, slot: number, rideId: number): void {
  const ride = world.rides.cols;
  let train = findRideTrain(world, rideId);
  if (train < 0) {
    train = spawnRideTrain(world, rideId, VehicleState.Waiting, ride.capacity[slot]);
    if (train < 0) {
      ride.state[slot] = RideState.Closed;
      ride.phase[slot] = RidePhase.Closed;
      return;
    }
    ride.phase[slot] = RidePhase.Waiting;
    ride.waitTicks[slot] = 0;
  }
  const v = world.vehicles.cols;
  switch (v.state[train]) {
    case VehicleState.Waiting:
      loadAndDispatch(world, slot, train);
      break;
    case VehicleState.Running:
      ride.phase[slot] = RidePhase.Running;
      break;
    default:
      removeRideTrains(world, rideId);
      ride.state[slot] = RideState.Broken;
      ride.phase[slot] = RidePhase.Broken;
      ride.breakdownCounter[slot]++;
  }
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
      if (ride.state[slot] === RideState.Open) {
        operate(world, slot, rideId);
      } else if (ride.phase[slot] !== RidePhase.Running) {
        removeRideTrains(world, rideId);
      }
    }
  },
};
