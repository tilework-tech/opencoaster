import type { World } from '../core/world';
import { circuitStatus } from '../track/construction';
import { removeRideTrains, spawnRideTrain } from '../vehicles/ride-trains';
import { VehicleState } from '../vehicles/vehicle-store';
import { RidePhase, RideState } from './ride-store';
import { RIDE_CATALOG } from './ride-types';
import type { RideType } from './ride-types';
import { RideResult } from './ride-results';

export function isTrackRide(world: World, rideId: number): boolean {
  if (!world.rides.isAlive(rideId)) return false;
  const typeId = world.rides.cols.typeId[world.rides.idToSlot[rideId]] as RideType;
  return RIDE_CATALOG[typeId]?.usesTrack === true;
}

function inActiveCycle(phase: number): boolean {
  return (
    phase === RidePhase.Loading || phase === RidePhase.Running || phase === RidePhase.Unloading
  );
}

/**
 * Ends the current cycle without a train coming home (track edited, train lost, ride reset):
 * riders still get off because their ride is marked completed, but no wear or breakdown roll
 * happens.
 */
export function abortCycle(world: World, slot: number): void {
  const ride = world.rides.cols;
  if (inActiveCycle(ride.phase[slot])) {
    ride.cyclesCompleted[slot]++;
    ride.guestsServed[slot] += ride.boarded[slot];
  }
  ride.boarded[slot] = 0;
  ride.waitTicks[slot] = 0;
  ride.phaseTicks[slot] = 0;
  ride.phase[slot] = ride.state[slot] === RideState.Broken ? RidePhase.Broken : RidePhase.Closed;
}

/** Takes the ride out of service because its train stalled, crashed or never came back. */
export function breakDownRide(world: World, slot: number): void {
  const ride = world.rides.cols;
  removeRideTrains(world, world.rides.slotToId[slot]);
  ride.state[slot] = RideState.Broken;
  abortCycle(world, slot);
  ride.breakdownCounter[slot]++;
}

/**
 * Manual reset of a broken coaster: the layout must be tested again before it can reopen.
 */
export function resetBrokenRide(world: World, slot: number): void {
  const ride = world.rides.cols;
  removeRideTrains(world, world.rides.slotToId[slot]);
  ride.state[slot] = RideState.Closed;
  abortCycle(world, slot);
  ride.tested[slot] = 0;
}

/**
 * Called when a ride's track changes: the earlier test no longer describes the layout, so the
 * ride closes, loses its trains and must be tested again before it can reopen.
 */
export function invalidateRideTest(world: World, rideId: number): void {
  if (!isTrackRide(world, rideId)) return;
  const slot = world.rides.idToSlot[rideId];
  const ride = world.rides.cols;
  removeRideTrains(world, rideId);
  if (ride.state[slot] !== RideState.Broken) ride.state[slot] = RideState.Closed;
  abortCycle(world, slot);
  ride.tested[slot] = 0;
}

/** Sends a test train around the closed circuit; the coaster system collects the result. */
export function startRideTest(world: World, rideId: number): RideResult {
  if (!world.rides.isAlive(rideId)) return RideResult.NoSuchRide;
  if (!isTrackRide(world, rideId)) return RideResult.NotTrackRide;
  const slot = world.rides.idToSlot[rideId];
  const ride = world.rides.cols;
  if (ride.state[slot] === RideState.Broken) return RideResult.Broken;
  if (
    ride.state[slot] === RideState.Open ||
    ride.state[slot] === RideState.Testing ||
    ride.phase[slot] === RidePhase.Running
  ) {
    return RideResult.Busy;
  }
  if (!circuitStatus(world, rideId).complete) return RideResult.TrackIncomplete;
  removeRideTrains(world, rideId);
  if (spawnRideTrain(world, rideId, VehicleState.Testing, 0) < 0) {
    return RideResult.TrackIncomplete;
  }
  ride.tested[slot] = 0;
  ride.state[slot] = RideState.Testing;
  ride.phase[slot] = RidePhase.Running;
  return RideResult.Ok;
}

/** Ends a test run early (or discards a finished train) and returns the ride to Closed. */
export function abortRideTest(world: World, rideId: number): void {
  if (!world.rides.isAlive(rideId)) return;
  const slot = world.rides.idToSlot[rideId];
  removeRideTrains(world, rideId);
  world.rides.cols.state[slot] = RideState.Closed;
  world.rides.cols.phase[slot] = RidePhase.Closed;
}
