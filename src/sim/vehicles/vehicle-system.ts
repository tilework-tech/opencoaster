import type { World } from '../core/world';
import type { System } from '../core/system';
import { calculateTrackedRideRatings } from './vehicle-ratings';
import { setRideRatings, VehicleState } from './vehicle-store';
import { VehicleSegmentFlag } from './vehicle-track';
import type { VehicleTrack, VehicleTrackRegistry } from './vehicle-track';

export { VehicleState } from './vehicle-store';
export { VehicleSegmentFlag, VehicleTrackRegistry, createVehicleTrack } from './vehicle-track';
export type { VehicleTrack, VehicleTrackInput } from './vehicle-track';
export { calculateTrackedRideRatings } from './vehicle-ratings';

const Q8 = 256;
const GRAVITY_Q8 = 32;
const ROLLING_FRICTION_Q8 = 4;
const DRAG_DIVISOR = 1 << 22;
const LIFT_SPEED_Q8 = 1280;
const LAUNCH_SPEED_Q8 = 4096;
const LAUNCH_ACCEL_Q8 = 96;
const BRAKE_SPEED_Q8 = 512;
const BRAKE_DECEL_Q8 = 160;
const OPEN_BLOCK_SPEED_Q8 = 4 * Q8;
const COLLISION_SPEED_Q8 = 48 * Q8;
const STALL_TICKS = 80;

interface VehicleWorld extends World {
  vehicleTracks?: VehicleTrackRegistry;
}

function integerSqrt(value: number): number {
  if (value <= 0) return 0;
  let x = value;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(value / x)) / 2);
  }
  return x;
}

function segmentAt(track: VehicleTrack, positionQ8: number): number {
  let segment = 0;
  while (
    segment + 1 < track.cumulativeLengthsQ8.length - 1 &&
    positionQ8 >= track.cumulativeLengthsQ8[segment + 1]
  ) {
    segment++;
  }
  return segment;
}

function pointAt(
  track: VehicleTrack,
  positionQ8: number,
  segment: number,
): [number, number, number] {
  const start = segment * 3;
  const segmentStart = track.cumulativeLengthsQ8[segment];
  const segmentLengthQ8 = track.segmentLengths[segment] << 8;
  const localQ8 = Math.max(0, Math.min(segmentLengthQ8, positionQ8 - segmentStart));
  const x =
    track.points[start] +
    Math.trunc(((track.points[start + 3] - track.points[start]) * localQ8) / segmentLengthQ8);
  const y =
    track.points[start + 1] +
    Math.trunc(((track.points[start + 4] - track.points[start + 1]) * localQ8) / segmentLengthQ8);
  const z =
    track.points[start + 2] +
    Math.trunc(((track.points[start + 5] - track.points[start + 2]) * localQ8) / segmentLengthQ8);
  return [x, y, z];
}

function slopeAcceleration(track: VehicleTrack, segment: number): number {
  const point = segment * 3;
  const dz = track.points[point + 5] - track.points[point + 2];
  return Math.trunc((-dz * GRAVITY_Q8) / track.segmentLengths[segment]);
}

function curveGQ8(speedQ8: number, curvatureQ8: number): number {
  return Math.trunc((speedQ8 * speedQ8 * curvatureQ8) / (Q8 * Q8 * Q8));
}

function verticalGravityGQ8(track: VehicleTrack, segment: number): number {
  const point = segment * 3;
  const dx = track.points[point + 3] - track.points[point];
  const dy = track.points[point + 4] - track.points[point + 1];
  const horizontalLength = integerSqrt(dx * dx + dy * dy);
  return Math.trunc((horizontalLength * Q8) / track.segmentLengths[segment]);
}

function controlSpeed(track: VehicleTrack, segment: number, speed: number): number {
  const flags = track.segmentFlags[segment];
  if (flags & VehicleSegmentFlag.ChainLift) return Math.max(speed, LIFT_SPEED_Q8);
  if (flags & VehicleSegmentFlag.Launch) return Math.min(LAUNCH_SPEED_Q8, speed + LAUNCH_ACCEL_Q8);
  if (flags & VehicleSegmentFlag.Brake) {
    return Math.min(speed, Math.max(BRAKE_SPEED_Q8, speed - BRAKE_DECEL_Q8));
  }
  if (flags & VehicleSegmentFlag.Block) return Math.min(speed, OPEN_BLOCK_SPEED_Q8);
  return speed;
}

function enterSegment(
  world: World,
  track: VehicleTrack,
  slot: number,
  segment: number,
  speed: number,
): boolean {
  const cols = world.vehicles.cols;
  const flags = track.segmentFlags[segment];
  if (
    track.crashable &&
    ((flags & VehicleSegmentFlag.Crest && speed > track.crestCrashSpeedQ8) ||
      (flags & VehicleSegmentFlag.DropStart && speed > track.dropCrashSpeedQ8))
  ) {
    cols.state[slot] = VehicleState.Crashed;
    return false;
  }
  if (cols.state[slot] === VehicleState.Testing) {
    if (flags & VehicleSegmentFlag.DropStart) {
      cols.dropCount[slot] = Math.min(0xff, cols.dropCount[slot] + 1);
      cols.highestDrop[slot] = Math.max(cols.highestDrop[slot], track.dropHeights[segment]);
    }
    if (flags & VehicleSegmentFlag.Inversion) {
      cols.inversionCount[slot] = Math.min(0xff, cols.inversionCount[slot] + 1);
    }
  }
  cols.lastSegment[slot] = segment;
  return true;
}

function updateRideTestStats(world: World, slot: number): void {
  const cols = world.vehicles.cols;
  cols.rideLength[slot] = cols.distanceTravelled[slot];
  cols.averageSpeed[slot] = cols.elapsedTicks[slot]
    ? Math.trunc(cols.speedTotal[slot] / cols.elapsedTicks[slot])
    : 0;
  const rating = calculateTrackedRideRatings({
    maxSpeed: cols.maxSpeed[slot],
    averageSpeed: cols.averageSpeed[slot],
    dropCount: cols.dropCount[slot],
    highestDrop: cols.highestDrop[slot],
    inversionCount: cols.inversionCount[slot],
    maxVerticalGQ8: cols.maxVerticalGQ8[slot],
    minVerticalGQ8: cols.minVerticalGQ8[slot],
    maxLateralGQ8: cols.maxLateralGQ8[slot],
    rideLength: cols.rideLength[slot],
    airtimeTicks: cols.airtimeTicks[slot],
  });
  cols.excitement[slot] = rating.excitement;
  cols.intensity[slot] = rating.intensity;
  cols.nausea[slot] = rating.nausea;
  setRideRatings(world, cols.rideId[slot], rating.excitement, rating.intensity, rating.nausea);
}

function applyStationDispatch(world: World, track: VehicleTrack, slot: number): boolean {
  const cols = world.vehicles.cols;
  const segment = segmentAt(track, cols.trackPos[slot]);
  if (!(track.segmentFlags[segment] & VehicleSegmentFlag.Station)) return false;
  cols.dispatchTicks[slot] = Math.min(0xffff, cols.dispatchTicks[slot] + 1);
  const hasFullLoad = cols.capacity[slot] > 0 && cols.passengers[slot] >= cols.capacity[slot];
  const minWaitMet = cols.dispatchTicks[slot] >= cols.minWaitTicks[slot];
  const maxWaitMet =
    cols.maxWaitTicks[slot] > 0 && cols.dispatchTicks[slot] >= cols.maxWaitTicks[slot];
  if (minWaitMet && (hasFullLoad || maxWaitMet)) {
    cols.state[slot] = VehicleState.Running;
    cols.dispatchTicks[slot] = 0;
    return true;
  }
  return false;
}

function advanceTrain(world: World, track: VehicleTrack, slot: number): void {
  const cols = world.vehicles.cols;
  const state = cols.state[slot];
  if (state === VehicleState.Waiting) {
    applyStationDispatch(world, track, slot);
    if (cols.state[slot] !== VehicleState.Running) return;
  } else if (state !== VehicleState.Running && state !== VehicleState.Testing) {
    return;
  }

  const testing = cols.state[slot] === VehicleState.Testing;
  const position = Math.max(0, cols.trackPos[slot]);
  let segment = segmentAt(track, position);
  const speed = cols.speed[slot];
  if (cols.lastSegment[slot] !== segment && !enterSegment(world, track, slot, segment, speed))
    return;

  const mass = Math.max(64, cols.mass[slot]);
  const rollingFriction = Math.max(1, Math.trunc((ROLLING_FRICTION_Q8 * 1024) / mass));
  const speedDrag = Math.trunc((speed * speed) / DRAG_DIVISOR);
  let nextSpeed = Math.max(
    0,
    speed + slopeAcceleration(track, segment) - rollingFriction - speedDrag,
  );
  nextSpeed = controlSpeed(track, segment, nextSpeed);
  let nextPosition = position;
  let remainingDistance = nextSpeed;
  let guard = 0;
  while (
    remainingDistance > 0 &&
    nextPosition < track.totalLengthQ8 &&
    guard++ < track.segmentLengths.length
  ) {
    const boundary = track.cumulativeLengthsQ8[segment + 1];
    const distanceToBoundary = boundary - nextPosition;
    if (remainingDistance < distanceToBoundary) {
      nextPosition += remainingDistance;
      break;
    }
    nextPosition = boundary;
    remainingDistance -= distanceToBoundary;
    if (nextPosition >= track.totalLengthQ8) break;

    const enteredSegment = segment + 1;
    const flags = track.segmentFlags[enteredSegment];
    const occupant = track.blockOccupiedBy[enteredSegment];
    if (
      flags & VehicleSegmentFlag.Block &&
      (track.blockOpen[enteredSegment] === 0 || (occupant !== -1 && occupant !== slot))
    ) {
      nextSpeed = 0;
      break;
    }
    segment = enteredSegment;
    if (flags & VehicleSegmentFlag.Block) track.blockOccupiedBy[segment] = slot;
    if (!enterSegment(world, track, slot, segment, nextSpeed)) return;
    const controlledSpeed = controlSpeed(track, segment, nextSpeed);
    remainingDistance = Math.max(0, remainingDistance + controlledSpeed - nextSpeed);
    nextSpeed = controlledSpeed;
  }
  nextPosition = Math.min(nextPosition, track.totalLengthQ8);

  const finalSegment = segmentAt(track, Math.min(nextPosition, track.totalLengthQ8 - 1));
  if (
    track.segmentFlags[finalSegment] & VehicleSegmentFlag.Block &&
    track.blockOpen[finalSegment] === 0
  ) {
    nextPosition = track.cumulativeLengthsQ8[finalSegment];
    nextSpeed = 0;
  }

  const [x, y, z] = pointAt(track, nextPosition, finalSegment);
  cols.x[slot] = x;
  cols.y[slot] = y;
  cols.z[slot] = z;
  cols.trackPos[slot] = nextPosition;
  cols.speed[slot] = nextSpeed;
  cols.maxSpeed[slot] = Math.min(0xffff, Math.max(cols.maxSpeed[slot], nextSpeed));

  if (testing) {
    const sampleSegment = finalSegment;
    const verticalG =
      verticalGravityGQ8(track, sampleSegment) +
      curveGQ8(nextSpeed, track.verticalCurvatureQ8[sampleSegment]);
    const lateralG = Math.abs(curveGQ8(nextSpeed, track.lateralCurvatureQ8[sampleSegment]));
    cols.maxVerticalGQ8[slot] = Math.max(cols.maxVerticalGQ8[slot], verticalG);
    cols.minVerticalGQ8[slot] = Math.min(cols.minVerticalGQ8[slot], verticalG);
    cols.maxLateralGQ8[slot] = Math.max(cols.maxLateralGQ8[slot], lateralG);
    if (verticalG <= 0) cols.airtimeTicks[slot]++;
    cols.elapsedTicks[slot]++;
    cols.speedTotal[slot] += nextSpeed;
    cols.distanceTravelled[slot] += Math.max(0, nextPosition - position);
    if (nextSpeed === 0 && slopeAcceleration(track, sampleSegment) < 0) {
      if (cols.dispatchTicks[slot] < 0xffff) cols.dispatchTicks[slot]++;
      if (cols.dispatchTicks[slot] >= STALL_TICKS) cols.state[slot] = VehicleState.Stalled;
    } else {
      cols.dispatchTicks[slot] = 0;
    }
  }

  if (nextPosition >= track.totalLengthQ8) {
    cols.completedCircuits[slot]++;
    if (testing) {
      cols.state[slot] = VehicleState.TestComplete;
      updateRideTestStats(world, slot);
    } else if (track.loop) {
      cols.trackPos[slot] = 0;
      cols.lastSegment[slot] = 0xffff;
    } else {
      cols.state[slot] = VehicleState.Waiting;
      cols.trackPos[slot] = 0;
    }
  }
}

/** Advances trains in slot order; track metadata is precomputed when layouts change. */
export function stepVehicles(world: World, tracks: VehicleTrackRegistry): void {
  const cols = world.vehicles.cols;
  for (const track of tracks.all()) track.blockOccupiedBy.fill(-1);
  for (let slot = 0; slot < world.vehicles.count; slot++) {
    const state = cols.state[slot];
    const moving = state === VehicleState.Running || state === VehicleState.Testing;
    if (!moving && state !== VehicleState.Waiting) continue;
    const track = tracks.get(cols.rideId[slot]);
    if (!track) continue;
    const segment = segmentAt(track, Math.max(0, cols.trackPos[slot]));
    if (
      track.segmentFlags[segment] & VehicleSegmentFlag.Block &&
      cols.trackPos[slot] > track.cumulativeLengthsQ8[segment] &&
      cols.trackPos[slot] < track.cumulativeLengthsQ8[segment + 1]
    ) {
      track.blockOccupiedBy[segment] = slot;
    }
    if (!moving || !track.crashable) continue;
    for (let other = 0; other < slot; other++) {
      if (
        cols.state[other] !== VehicleState.Running &&
        cols.state[other] !== VehicleState.Testing
      ) {
        continue;
      }
      if (
        cols.rideId[other] === cols.rideId[slot] &&
        cols.speed[other] + cols.speed[slot] >= COLLISION_SPEED_Q8 &&
        Math.abs(cols.trackPos[other] - cols.trackPos[slot]) <=
          Math.abs(cols.speed[other] - cols.speed[slot])
      ) {
        cols.state[other] = VehicleState.Crashed;
        cols.state[slot] = VehicleState.Crashed;
      }
    }
  }
  for (let slot = 0; slot < world.vehicles.count; slot++) {
    const track = tracks.get(cols.rideId[slot]);
    if (track) advanceTrain(world, track, slot);
  }
}

export const vehicleSystem: System = {
  name: 'vehicles',
  update(world) {
    const tracks = (world as VehicleWorld).vehicleTracks;
    if (tracks) stepVehicles(world, tracks);
  },
};
