import type { World } from '../core/world';
import type { System } from '../core/system';
import { calculateTrackedRideRatings } from './vehicle-ratings';
import { setRideRatings, VehicleState } from './vehicle-store';
import { syncVehicleTracks, VehicleSegmentFlag, VehicleTrackRegistry } from './vehicle-track';
import type { VehicleTrack } from './vehicle-track';

export { VehicleState } from './vehicle-store';
export {
  VehicleSegmentFlag,
  VehicleTrackRegistry,
  createVehicleTrack,
  createVehicleTrackFromPath,
  syncVehicleTracks,
} from './vehicle-track';
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
const STATION_DRIVE_Q8 = 512;
const BRAKE_DECEL_Q8 = 160;
const OPEN_BLOCK_SPEED_Q8 = 4 * Q8;
const COLLISION_SPEED_Q8 = 48 * Q8;
const STALL_TICKS = 80;

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

function slopeAcceleration(track: VehicleTrack, segment: number): number {
  const point = segment * 3;
  const dz = track.points[point + 5] - track.points[point + 2];
  return Math.trunc((-dz * GRAVITY_Q8) / track.segmentLengths[segment]);
}

function curveGQ8(speedQ8: number, curvatureQ8: number): number {
  return Math.trunc((speedQ8 * speedQ8 * curvatureQ8 * Q8 * Q8) / (Q8 * Q8 * Q8 * GRAVITY_Q8));
}

function verticalGravityGQ8(track: VehicleTrack, segment: number): number {
  const point = segment * 3;
  const dx = track.points[point + 3] - track.points[point];
  const dy = track.points[point + 4] - track.points[point + 1];
  const horizontalLength = integerSqrt(dx * dx + dy * dy);
  return Math.trunc((horizontalLength * Q8) / track.segmentLengths[segment]);
}

function sampleForces(
  world: World,
  track: VehicleTrack,
  slot: number,
  segment: number,
  speed: number,
): boolean {
  const cols = world.vehicles.cols;
  const inverted = track.invertedSegments[segment];
  const orientationSign = inverted ? -1 : 1;
  const verticalG =
    (verticalGravityGQ8(track, segment) + curveGQ8(speed, track.verticalCurvatureQ8[segment])) *
    orientationSign;
  const lateralG = Math.abs(
    Math.trunc(
      (curveGQ8(speed, track.lateralCurvatureQ8[segment]) * track.bankCosQ8[segment]) / Q8,
    ) - track.bankSinQ8[segment],
  );
  const boundedVerticalG = Math.max(-0x8000, Math.min(0x7fff, verticalG));
  const boundedLateralG = Math.min(0xffff, lateralG);
  cols.maxVerticalGQ8[slot] = Math.max(cols.maxVerticalGQ8[slot], boundedVerticalG);
  cols.minVerticalGQ8[slot] = Math.min(cols.minVerticalGQ8[slot], boundedVerticalG);
  cols.maxLateralGQ8[slot] = Math.max(cols.maxLateralGQ8[slot], boundedLateralG);
  return verticalG <= 0;
}

function controlSpeed(track: VehicleTrack, segment: number, speed: number, timeQ8 = Q8): number {
  const flags = track.segmentFlags[segment];
  if (flags & VehicleSegmentFlag.StationDrive) return Math.max(speed, STATION_DRIVE_Q8);
  if (flags & VehicleSegmentFlag.ChainLift) return Math.max(speed, LIFT_SPEED_Q8);
  if (flags & VehicleSegmentFlag.Launch) {
    return Math.min(LAUNCH_SPEED_Q8, speed + Math.trunc((LAUNCH_ACCEL_Q8 * timeQ8) / Q8));
  }
  if (flags & VehicleSegmentFlag.Brake) {
    return Math.min(
      speed,
      Math.max(BRAKE_SPEED_Q8, speed - Math.trunc((BRAKE_DECEL_Q8 * timeQ8) / Q8)),
    );
  }
  if (flags & VehicleSegmentFlag.Block) return Math.min(speed, OPEN_BLOCK_SPEED_Q8);
  return speed;
}

function trainContactWithinTick(
  track: VehicleTrack,
  posA: number,
  speedA: number,
  posB: number,
  speedB: number,
): boolean {
  if (posA === posB) return true;
  let gap: number;
  let closingSpeed: number;
  if (track.loop) {
    const aToB = (posB - posA + track.totalLengthQ8) % track.totalLengthQ8;
    const bToA = track.totalLengthQ8 - aToB;
    if (speedA > speedB) {
      gap = aToB;
      closingSpeed = speedA - speedB;
    } else {
      gap = bToA;
      closingSpeed = speedB - speedA;
    }
  } else if (posA > posB) {
    gap = posA - posB;
    closingSpeed = speedB - speedA;
  } else {
    gap = posB - posA;
    closingSpeed = speedA - speedB;
  }
  return closingSpeed > 0 && gap <= closingSpeed;
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
  if (
    flags & VehicleSegmentFlag.Station &&
    track.loop &&
    cols.lastSegment[slot] !== 0xffff &&
    (cols.state[slot] === VehicleState.Running || cols.state[slot] === VehicleState.Testing)
  ) {
    cols.completedCircuits[slot]++;
    arriveAtStation(world, track, slot, segment);
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

/** Stops a train at the start of a station segment; a finished test run records its ratings. */
function arriveAtStation(world: World, track: VehicleTrack, slot: number, segment: number): void {
  const cols = world.vehicles.cols;
  const point = segment * 3;
  cols.x[slot] = track.points[point];
  cols.y[slot] = track.points[point + 1];
  cols.z[slot] = track.points[point + 2];
  cols.trackPos[slot] = track.cumulativeLengthsQ8[segment];
  cols.speed[slot] = 0;
  cols.lastSegment[slot] = segment;
  cols.dispatchTicks[slot] = 0;
  if (cols.state[slot] === VehicleState.Testing) {
    cols.state[slot] = VehicleState.TestComplete;
    updateRideTestStats(world, slot);
  } else {
    cols.state[slot] = VehicleState.Waiting;
  }
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
  cols.maxSpeed[slot] = Math.min(0xffff, Math.max(cols.maxSpeed[slot], speed));
  if (cols.lastSegment[slot] !== segment && !enterSegment(world, track, slot, segment, speed))
    return;

  const mass = Math.max(64, cols.mass[slot]);
  const rollingFriction = Math.max(1, Math.trunc((ROLLING_FRICTION_Q8 * 1024) / mass));
  let currentSpeed = speed;
  let nextPosition = position;
  let timeRemaining = Q8;
  let guard = 0;
  let airtime = false;
  while (
    timeRemaining > 0 &&
    nextPosition < track.totalLengthQ8 &&
    guard++ < track.segmentLengths.length
  ) {
    const speedDrag = Math.trunc((currentSpeed * currentSpeed) / DRAG_DIVISOR);
    const acceleration = slopeAcceleration(track, segment) - rollingFriction - speedDrag;
    let segmentEndSpeed = Math.max(
      0,
      currentSpeed + Math.trunc((acceleration * timeRemaining) / Q8),
    );
    segmentEndSpeed = controlSpeed(track, segment, segmentEndSpeed, timeRemaining);
    const averageSpeed = Math.trunc((currentSpeed + segmentEndSpeed) / 2);
    const availableDistance = Math.trunc((averageSpeed * timeRemaining) / Q8);
    const boundary = track.cumulativeLengthsQ8[segment + 1];
    const distanceToBoundary = boundary - nextPosition;
    if (availableDistance < distanceToBoundary) {
      nextPosition += availableDistance;
      currentSpeed = segmentEndSpeed;
      break;
    }
    const timeToBoundary = Math.min(
      timeRemaining,
      Math.max(1, Math.ceil((distanceToBoundary * Q8) / Math.max(averageSpeed, 1))),
    );
    currentSpeed = Math.max(0, currentSpeed + Math.trunc((acceleration * timeToBoundary) / Q8));
    currentSpeed = controlSpeed(track, segment, currentSpeed, timeToBoundary);
    cols.maxSpeed[slot] = Math.min(0xffff, Math.max(cols.maxSpeed[slot], currentSpeed));
    nextPosition = boundary;
    timeRemaining -= timeToBoundary;
    if (testing) airtime ||= sampleForces(world, track, slot, segment, currentSpeed);
    if (nextPosition >= track.totalLengthQ8) break;

    const enteredSegment = segment + 1;
    const flags = track.segmentFlags[enteredSegment];
    const section = track.blockSectionStart[enteredSegment];
    const occupant = track.blockOccupiedBy[section];
    if (
      flags & VehicleSegmentFlag.Block &&
      (track.blockOpen[enteredSegment] === 0 || (occupant !== -1 && occupant !== slot))
    ) {
      currentSpeed = 0;
      break;
    }
    segment = enteredSegment;
    if (flags & VehicleSegmentFlag.Block) track.blockOccupiedBy[section] = slot;
    if (!enterSegment(world, track, slot, segment, currentSpeed)) return;
  }
  nextPosition = Math.min(nextPosition, track.totalLengthQ8);
  let nextSpeed = currentSpeed;
  cols.maxSpeed[slot] = Math.min(0xffff, Math.max(cols.maxSpeed[slot], nextSpeed));

  const finalSegment = segmentAt(track, Math.min(nextPosition, track.totalLengthQ8 - 1));
  if (
    track.segmentFlags[finalSegment] & VehicleSegmentFlag.Block &&
    track.blockOpen[finalSegment] === 0
  ) {
    nextPosition = Math.max(nextPosition, track.cumulativeLengthsQ8[finalSegment]);
    nextSpeed = 0;
  }

  const point = finalSegment * 3;
  const segmentStart = track.cumulativeLengthsQ8[finalSegment];
  const segmentLengthQ8 = track.segmentLengths[finalSegment] << 8;
  const localQ8 = Math.max(0, Math.min(segmentLengthQ8, nextPosition - segmentStart));
  cols.x[slot] =
    track.points[point] +
    Math.trunc(((track.points[point + 3] - track.points[point]) * localQ8) / segmentLengthQ8);
  cols.y[slot] =
    track.points[point + 1] +
    Math.trunc(((track.points[point + 4] - track.points[point + 1]) * localQ8) / segmentLengthQ8);
  cols.z[slot] =
    track.points[point + 2] +
    Math.trunc(((track.points[point + 5] - track.points[point + 2]) * localQ8) / segmentLengthQ8);
  cols.trackPos[slot] = nextPosition;
  cols.speed[slot] = nextSpeed;

  if (testing) {
    airtime ||= sampleForces(world, track, slot, finalSegment, nextSpeed);
    if (airtime) cols.airtimeTicks[slot]++;
    cols.elapsedTicks[slot]++;
    cols.speedTotal[slot] += nextSpeed;
    cols.distanceTravelled[slot] += Math.max(0, nextPosition - position);
    if (nextSpeed === 0 && slopeAcceleration(track, finalSegment) < 0) {
      if (cols.dispatchTicks[slot] < 0xffff) cols.dispatchTicks[slot]++;
      if (cols.dispatchTicks[slot] >= STALL_TICKS) cols.state[slot] = VehicleState.Stalled;
    } else {
      cols.dispatchTicks[slot] = 0;
    }
  }

  if (nextPosition >= track.totalLengthQ8) {
    cols.completedCircuits[slot]++;
    if (testing && !(track.loop && track.stationSegment > 0)) {
      cols.state[slot] = VehicleState.TestComplete;
      updateRideTestStats(world, slot);
    } else if (track.loop) {
      cols.trackPos[slot] = 0;
      cols.lastSegment[slot] = 0xffff;
      if (!testing && track.stationSegment === 0) arriveAtStation(world, track, slot, 0);
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
      cols.trackPos[slot] >= track.cumulativeLengthsQ8[segment] &&
      cols.trackPos[slot] < track.cumulativeLengthsQ8[segment + 1]
    ) {
      track.blockOccupiedBy[track.blockSectionStart[segment]] = slot;
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
        trainContactWithinTick(
          track,
          cols.trackPos[other],
          cols.speed[other],
          cols.trackPos[slot],
          cols.speed[slot],
        )
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
    if (world.vehicles.count === 0) return;
    const tracks = world.vehicleTracks ?? new VehicleTrackRegistry();
    world.vehicleTracks = tracks;
    syncVehicleTracks(world, tracks);
    stepVehicles(world, tracks);
  },
};
