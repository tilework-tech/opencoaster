import type { World } from '../core/world';
import type { VehicleState } from './vehicle-store';
import { spawnTrain } from './vehicle-store';
import { syncVehicleTracks, VehicleTrackRegistry } from './vehicle-track';

/** Dispatch is driven by the ride's own operating rules, so the train never self-dispatches. */
const RIDE_MANAGED_MIN_WAIT = 0xffff;
/** Loaded trains are heavy enough that rolling friction does not stop them on short flats. */
const RIDE_TRAIN_MASS = 4096;

/** Slot of the first train belonging to the ride, or -1. */
export function findRideTrain(world: World, rideId: number): number {
  const cols = world.vehicles.cols;
  for (let slot = 0; slot < world.vehicles.count; slot++) {
    if (cols.rideId[slot] === rideId) return slot;
  }
  return -1;
}

export function removeRideTrains(world: World, rideId: number): void {
  for (let slot = world.vehicles.count - 1; slot >= 0; slot--) {
    if (world.vehicles.cols.rideId[slot] === rideId) world.vehicles.despawnSlot(slot);
  }
}

/**
 * Places a train at the start of the ride's station, ready to be dispatched (`Waiting`) or to
 * start a test lap (`Testing`). Returns the vehicle slot, or -1 when the ride has no station.
 */
export function spawnRideTrain(
  world: World,
  rideId: number,
  state: VehicleState.Waiting | VehicleState.Testing,
  capacity: number,
): number {
  const tracks = (world.vehicleTracks ??= new VehicleTrackRegistry());
  syncVehicleTracks(world, tracks);
  const track = tracks.get(rideId);
  if (!track || track.stationSegment < 0) return -1;
  const slot = spawnTrain(world, {
    rideId,
    state,
    capacity,
    minWaitTicks: RIDE_MANAGED_MIN_WAIT,
    mass: RIDE_TRAIN_MASS,
  });
  if (slot < 0) return -1;
  const cols = world.vehicles.cols;
  const point = track.stationSegment * 3;
  cols.trackPos[slot] = track.cumulativeLengthsQ8[track.stationSegment];
  cols.x[slot] = track.points[point];
  cols.y[slot] = track.points[point + 1];
  cols.z[slot] = track.points[point + 2];
  cols.lastSegment[slot] = track.stationSegment;
  return slot;
}
