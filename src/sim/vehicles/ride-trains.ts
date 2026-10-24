import type { World } from '../core/world';
import { spawnTrain, VehicleState } from './vehicle-store';
import { syncVehicleTracks, VehicleTrackRegistry } from './vehicle-track';

/** Dispatch is driven by the ride's own operating rules, so the train never self-dispatches. */
const RIDE_MANAGED_MIN_WAIT = 0xffff;
/** Empty mass of one car; riders add `PASSENGER_MASS` each, so loaded trains run more freely. */
export const CAR_MASS = 1800;
export const RIDERS_PER_CAR = 4;
/** A train must fit inside the station piece. */
export const MAX_CARS = 5;
/** Most trains a coaster runs at once, however many block sections it has. */
export const MAX_TRAINS_PER_RIDE = 4;

export function carsForCapacity(capacity: number): number {
  return Math.max(1, Math.min(MAX_CARS, Math.ceil(capacity / RIDERS_PER_CAR)));
}

/** Slot of the first train belonging to the ride, or -1. */
export function findRideTrain(world: World, rideId: number): number {
  const cols = world.vehicles.cols;
  for (let slot = 0; slot < world.vehicles.count; slot++) {
    if (cols.rideId[slot] === rideId) return slot;
  }
  return -1;
}

/** Slots of every train belonging to the ride, in slot order. */
export function rideTrainSlots(world: World, rideId: number): number[] {
  const out: number[] = [];
  const cols = world.vehicles.cols;
  for (let slot = 0; slot < world.vehicles.count; slot++) {
    if (cols.rideId[slot] === rideId) out.push(slot);
  }
  return out;
}

export function removeRideTrains(world: World, rideId: number): void {
  for (let slot = world.vehicles.count - 1; slot >= 0; slot--) {
    if (world.vehicles.cols.rideId[slot] === rideId) world.vehicles.despawnSlot(slot);
  }
}

/**
 * Puts a train in the ride's station: a `Waiting` train stands at the platform's far end ready to
 * load; a `Testing` train starts its lap at the platform's near end. Returns the vehicle slot, or
 * -1 when the ride has no station.
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
  const carCount = carsForCapacity(capacity > 0 ? capacity : 16);
  const slot = spawnTrain(world, {
    rideId,
    state,
    capacity,
    minWaitTicks: RIDE_MANAGED_MIN_WAIT,
    mass: carCount * CAR_MASS,
    carCount,
  });
  if (slot < 0) return -1;
  const cols = world.vehicles.cols;
  const atEnd =
    state === VehicleState.Waiting &&
    track.stationEndSegment >= 0 &&
    track.stationEndSegment < track.segmentLengths.length;
  const segment = atEnd ? track.stationEndSegment : track.stationSegment;
  const point = segment * 3;
  cols.trackPos[slot] = track.cumulativeLengthsQ8[segment];
  cols.x[slot] = track.points[point];
  cols.y[slot] = track.points[point + 1];
  cols.z[slot] = track.points[point + 2];
  cols.lastSegment[slot] = atEnd ? segment - 1 : segment;
  return slot;
}
