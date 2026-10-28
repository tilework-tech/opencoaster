import type { World } from '../core/world';
import { RideState } from '../rides/ride-store';
import { spawnTrain, VehicleState } from './vehicle-store';
import { syncVehicleTracks, VehicleTrackRegistry } from './vehicle-track';
import type { VehicleTrack } from './vehicle-track';
import { CAR_LENGTH_Q8 } from './vehicle-system';
import { MAX_TRAINS_PER_RIDE, trainLimit } from './train-limit';

export { MAX_TRAINS_PER_RIDE };

/** Dispatch is driven by the ride's own operating rules, so the train never self-dispatches. */
const RIDE_MANAGED_MIN_WAIT = 0xffff;
/** Empty mass of one car; riders add `PASSENGER_MASS` each, so loaded trains run more freely. */
export const CAR_MASS = 1800;
export const RIDERS_PER_CAR = 4;
/** Most cars a train can have, before the station length limits it further. */
export const MAX_CARS = 5;

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

function positionTrainAtStation(
  world: World,
  track: VehicleTrack,
  slot: number,
  state: VehicleState.Waiting | VehicleState.Testing,
): void {
  const waiting = state === VehicleState.Waiting && track.stationEndSegment >= 0;
  const wrapsToStart = waiting && track.stationEndSegment >= track.segmentLengths.length;
  const atEnd = waiting && !wrapsToStart;
  const segment = atEnd ? track.stationEndSegment : wrapsToStart ? 0 : track.stationSegment;
  const point = segment * 3;
  const cols = world.vehicles.cols;
  cols.trackPos[slot] = track.cumulativeLengthsQ8[segment];
  cols.x[slot] = track.points[point];
  cols.y[slot] = track.points[point + 1];
  cols.z[slot] = track.points[point + 2];
  cols.lastSegment[slot] = atEnd ? segment - 1 : wrapsToStart ? 0xffff : segment;
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
  positionTrainAtStation(world, track, slot, state);
  return slot;
}

function currentTrack(world: World, rideId: number): VehicleTrack | undefined {
  const tracks = (world.vehicleTracks ??= new VehicleTrackRegistry());
  syncVehicleTracks(world, tracks);
  return tracks.get(rideId);
}

/** Restores parked and testing trains to the station positions implied by their ride state. */
export function repairSavedRideTrains(world: World): void {
  const vehicles = world.vehicles.cols;
  const rides = world.rides.cols;
  const parked: number[] = [];
  for (let slot = 0; slot < world.vehicles.count; slot++) {
    const rideSlot = world.rides.idToSlot[vehicles.rideId[slot]];
    if (rideSlot < 0) continue;
    const rideState = rides.state[rideSlot];
    if (
      (rideState === RideState.Closed ||
        rideState === RideState.Testing ||
        rideState === RideState.Open) &&
      (vehicles.state[slot] === VehicleState.Waiting ||
        vehicles.state[slot] === VehicleState.Testing)
    )
      parked.push(slot);
  }
  if (parked.length === 0) return;

  const tracks = (world.vehicleTracks ??= new VehicleTrackRegistry());
  syncVehicleTracks(world, tracks);
  for (const slot of parked) {
    const rideId = vehicles.rideId[slot];
    const state = vehicles.state[slot];
    const track = tracks.get(rideId);
    if (!track || track.stationSegment < 0) continue;

    positionTrainAtStation(world, track, slot, state);
    vehicles.speed[slot] = 0;
  }
}

/** Longest train the ride's station platform holds: the cars must all stand inside it. */
export function maxCarsForRide(world: World, rideId: number): number {
  const track = currentTrack(world, rideId);
  if (!track || track.stationSegment < 0 || track.stationEndQ8 < 0) return MAX_CARS;
  const platform = track.stationEndQ8 - track.cumulativeLengthsQ8[track.stationSegment];
  return Math.max(1, Math.min(MAX_CARS, Math.floor(platform / CAR_LENGTH_Q8)));
}

/** Block sections of the ride's circuit; 0 unless it runs block-sectioned. */
export function blockSectionsForRide(world: World, rideId: number): number {
  return currentTrack(world, rideId)?.boundariesQ8.length ?? 0;
}

/**
 * Most trains the ride runs at once: its block sections in block-sectioned mode, else the track
 * length over the train length (see `trainLimit`).
 */
export function maxTrainsForRide(world: World, rideId: number): number {
  const track = currentTrack(world, rideId);
  if (!track) return 1;
  const slot = world.rides.idToSlot[rideId];
  return trainLimit({
    blockSectioned: track.blockSectioned,
    sections: track.boundariesQ8.length,
    loop: track.loop,
    cars: carsForCapacity(world.rides.cols.capacity[slot]),
    trackLengthQ8: track.totalLengthQ8,
  });
}
