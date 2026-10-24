import type { World } from '../core/world';

export const enum VehicleState {
  Waiting = 0,
  Running = 1,
  Testing = 2,
  TestComplete = 3,
  Stalled = 4,
  Crashed = 5,
  /** Braking into the station after a lap. */
  Arriving = 6,
  /** Stopped in the station while riders get off. */
  Unloading = 7,
}

export interface SpawnTrainOptions {
  rideId: number;
  state?: VehicleState;
  trackPos?: number;
  speed?: number;
  mass?: number;
  carCount?: number;
  passengers?: number;
  capacity?: number;
  minWaitTicks?: number;
  maxWaitTicks?: number;
}

export interface TrainSnapshot {
  rideId: number;
  state: VehicleState;
  trackPos: number;
  speed: number;
  maxSpeed: number;
  averageSpeed: number;
  rideLength: number;
  rideTimeTicks: number;
  dropCount: number;
  highestDrop: number;
  inversionCount: number;
  maxVerticalGQ8: number;
  minVerticalGQ8: number;
  maxLateralGQ8: number;
  airtimeTicks: number;
  excitement: number;
  intensity: number;
  nausea: number;
}

/** One row per train. Car poses can be derived from train progress along its track. */
export const VEHICLE_SCHEMA = {
  x: Int32Array,
  y: Int32Array,
  z: Int32Array,
  rideId: Uint32Array,
  /** Progress and speed are Q8 world units; track coordinates use TILE_UNITS. */
  trackPos: Int32Array,
  speed: Int32Array,
  mass: Uint16Array,
  carCount: Uint8Array,
  passengers: Uint16Array,
  capacity: Uint16Array,
  state: Uint8Array,
  dispatchTicks: Uint16Array,
  minWaitTicks: Uint16Array,
  maxWaitTicks: Uint16Array,
  lastSegment: Uint16Array,
  completedCircuits: Uint16Array,
  elapsedTicks: Uint32Array,
  distanceTravelled: Uint32Array,
  speedTotal: Uint32Array,
  maxSpeed: Uint16Array,
  averageSpeed: Uint16Array,
  rideLength: Uint32Array,
  dropCount: Uint8Array,
  highestDrop: Uint16Array,
  inversionCount: Uint8Array,
  maxVerticalGQ8: Int16Array,
  minVerticalGQ8: Int16Array,
  maxLateralGQ8: Uint16Array,
  airtimeTicks: Uint32Array,
  excitement: Uint16Array,
  intensity: Uint16Array,
  nausea: Uint16Array,
} as const;

export function spawnTrain(world: Pick<World, 'vehicles'>, options: SpawnTrainOptions): number {
  const slot = world.vehicles.spawn();
  if (slot < 0) return -1;
  const cols = world.vehicles.cols;
  cols.rideId[slot] = options.rideId;
  cols.state[slot] = options.state ?? VehicleState.Waiting;
  cols.trackPos[slot] = (options.trackPos ?? 0) << 8;
  cols.speed[slot] = Math.max(0, Math.min(0xffff, Math.trunc(options.speed ?? 0)));
  cols.mass[slot] = options.mass ?? 512;
  cols.carCount[slot] = options.carCount ?? 1;
  cols.passengers[slot] = options.passengers ?? 0;
  cols.capacity[slot] = options.capacity ?? 1;
  cols.minWaitTicks[slot] = options.minWaitTicks ?? 0;
  cols.maxWaitTicks[slot] = options.maxWaitTicks ?? 0;
  cols.lastSegment[slot] = 0xffff;
  if (cols.state[slot] === VehicleState.Testing) {
    cols.maxVerticalGQ8[slot] = 256;
    cols.minVerticalGQ8[slot] = 256;
  }
  return slot;
}

export function getTrainState(world: Pick<World, 'vehicles'>, slot: number): TrainSnapshot {
  const cols = world.vehicles.cols;
  return {
    rideId: cols.rideId[slot],
    state: cols.state[slot],
    trackPos: cols.trackPos[slot],
    speed: cols.speed[slot],
    maxSpeed: cols.maxSpeed[slot],
    averageSpeed: cols.averageSpeed[slot],
    rideLength: cols.rideLength[slot],
    rideTimeTicks: cols.elapsedTicks[slot],
    dropCount: cols.dropCount[slot],
    highestDrop: cols.highestDrop[slot],
    inversionCount: cols.inversionCount[slot],
    maxVerticalGQ8: cols.maxVerticalGQ8[slot],
    minVerticalGQ8: cols.minVerticalGQ8[slot],
    maxLateralGQ8: cols.maxLateralGQ8[slot],
    airtimeTicks: cols.airtimeTicks[slot],
    excitement: cols.excitement[slot],
    intensity: cols.intensity[slot],
    nausea: cols.nausea[slot],
  };
}

export function setRideRatings(
  world: Pick<World, 'rides'>,
  rideId: number,
  excitement: number,
  intensity: number,
  nausea: number,
): void {
  if (!world.rides.isAlive(rideId)) return;
  const slot = world.rides.idToSlot[rideId];
  world.rides.cols.excitement[slot] = excitement;
  world.rides.cols.intensity[slot] = intensity;
  world.rides.cols.nausea[slot] = nausea;
}
