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
export { maxTrainsOnTrack } from './vehicle-track';

const Q8 = 256;
const GRAVITY_Q8 = 32;
/** Rolling friction is kept in Q10 (quarter Q8 steps) so heavy trains lose speed gradually. */
const FRICTION_SCALE = 4;
const ROLLING_FRICTION_Q10_AT_1024 = 16;
/** Mass of one rider, added to the train's mass while it is loaded. */
export const PASSENGER_MASS = 80;
/** Length of one car along the track, in Q8 world units. */
export const CAR_LENGTH_Q8 = 48 * Q8;
const STATION_BRAKE_DECEL_Q8 = 320;
const HOLD_BRAKE_DECEL_Q8 = 320;
const ARRIVAL_CREEP_Q8 = 128;
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
  const cumulative = track.cumulativeLengthsQ8;
  let low = 0;
  let high = cumulative.length - 2;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (positionQ8 >= cumulative[mid]) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** Segment under the car `offsetQ8` behind the head; before the start it wraps on loops. */
function carSegment(track: VehicleTrack, positionQ8: number, offsetQ8: number): number {
  let at = positionQ8 - offsetQ8;
  if (at < 0) at = track.loop ? at + track.totalLengthQ8 : 0;
  return segmentAt(track, Math.min(at, track.totalLengthQ8 - 1));
}

function slopeAcceleration(track: VehicleTrack, segment: number): number {
  const point = segment * 3;
  const dz = track.points[point + 5] - track.points[point + 2];
  return Math.trunc((-dz * GRAVITY_Q8) / track.segmentLengths[segment]);
}

function curveGQ8(speedQ8: number, curvatureQ8: number, shift: number): number {
  return Math.trunc((speedQ8 * speedQ8 * curvatureQ8) / (Q8 * GRAVITY_Q8 * (1 << shift)));
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
  const orientationSign = track.invertedSegments[segment] ? -1 : 1;
  const sinB = track.bankSinQ8[segment];
  const cosB = track.bankCosQ8[segment];
  const normalG =
    verticalGravityGQ8(track, segment) +
    curveGQ8(speed, track.verticalCurvatureQ8[segment], track.curvatureShift);
  const sideG = curveGQ8(speed, track.lateralCurvatureQ8[segment], track.curvatureShift);
  // Specific force in the rider's frame: the track normal and its sideways axis are rolled by the
  // bank angle, so a rolling piece such as a corkscrew moves gravity between seat and side.
  const verticalG =
    (Math.trunc((normalG * cosB) / Q8) + Math.trunc((sideG * sinB) / Q8)) * orientationSign;
  const lateralG = Math.abs(Math.trunc((sideG * cosB) / Q8) - Math.trunc((normalG * sinB) / Q8));
  const boundedVerticalG = Math.max(-0x8000, Math.min(0x7fff, verticalG));
  const boundedLateralG = Math.min(0xffff, lateralG);
  cols.maxVerticalGQ8[slot] = Math.max(cols.maxVerticalGQ8[slot], boundedVerticalG);
  cols.minVerticalGQ8[slot] = Math.min(cols.minVerticalGQ8[slot], boundedVerticalG);
  cols.maxLateralGQ8[slot] = Math.max(cols.maxLateralGQ8[slot], boundedLateralG);
  return verticalG <= 0;
}

function controlSpeed(flags: number, speed: number, timeQ8 = Q8, arriving = false): number {
  if (flags & VehicleSegmentFlag.StationDrive && !arriving)
    return Math.max(speed, STATION_DRIVE_Q8);
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

/** Control flags acting on the train: any car on a lift, brake or station drive is affected. */
function trainFlags(
  track: VehicleTrack,
  cars: number,
  positionQ8: number,
  headSegment: number,
): number {
  let flags = track.segmentFlags[headSegment];
  for (let car = 1; car < cars; car++) {
    flags |= track.segmentFlags[carSegment(track, positionQ8, car * CAR_LENGTH_Q8)];
  }
  return flags;
}

/** Slope acceleration averaged over every car, so a long train feels the whole hill. */
function trainSlopeAcceleration(
  track: VehicleTrack,
  cars: number,
  positionQ8: number,
  headSegment: number,
): number {
  let total = slopeAcceleration(track, headSegment);
  for (let car = 1; car < cars; car++) {
    total += slopeAcceleration(track, carSegment(track, positionQ8, car * CAR_LENGTH_Q8));
  }
  return cars > 1 ? Math.trunc(total / cars) : total;
}

function zoneOf(track: VehicleTrack, positionQ8: number): number {
  const ends = track.boundariesQ8;
  for (let zone = 0; zone < ends.length; zone++) if (positionQ8 <= ends[zone]) return zone;
  return 0;
}

function trainOccupiesZone(
  track: VehicleTrack,
  cols: World['vehicles']['cols'],
  slot: number,
  zone: number,
) {
  const front = cols.trackPos[slot];
  let rear = front - Math.max(1, cols.carCount[slot]) * CAR_LENGTH_Q8;
  if (rear < 0) rear += track.totalLengthQ8;
  return (
    zoneOf(track, Math.min(front, track.totalLengthQ8)) === zone || zoneOf(track, rear) === zone
  );
}

function otherTrainInZone(world: World, track: VehicleTrack, slot: number, zone: number): boolean {
  const cols = world.vehicles.cols;
  for (let other = 0; other < world.vehicles.count; other++) {
    if (other === slot || cols.rideId[other] !== track.rideId) continue;
    const state = cols.state[other];
    if (state === VehicleState.Crashed || state === VehicleState.Stalled) continue;
    if (trainOccupiesZone(track, cols, other, zone)) return true;
  }
  return false;
}

/**
 * Position where a Running train must stop: the end of the zone it is in when the next zone is
 * occupied. Returns -1 when the way is clear. May exceed the track length past the seam.
 */
function holdTarget(world: World, track: VehicleTrack, slot: number): number {
  const ends = track.boundariesQ8;
  if (ends.length < 2) return -1;
  const position = world.vehicles.cols.trackPos[slot];
  let best = -1;
  let bestDistance = 0;
  let bestZone = 0;
  for (let zone = 0; zone < ends.length; zone++) {
    let distance = ends[zone] - position;
    if (distance < 0) distance += track.totalLengthQ8;
    if (best < 0 || distance < bestDistance) {
      best = zone;
      bestDistance = distance;
      bestZone = zone;
    }
  }
  if (!otherTrainInZone(world, track, slot, (bestZone + 1) % ends.length)) return -1;
  return position + bestDistance;
}

/** True when the zone beyond the station is free, so a loaded train may leave. */
export function stationDepartureClear(world: World, track: VehicleTrack, slot: number): boolean {
  const ends = track.boundariesQ8;
  if (ends.length < 2 || track.stationEndQ8 < 0) return true;
  const zone = zoneOf(track, track.stationEndQ8);
  return !otherTrainInZone(world, track, slot, (zone + 1) % ends.length);
}

/** True while a train waits at a block-section boundary for the zone ahead to clear. */
export function trainHeldAtBoundary(world: World, track: VehicleTrack, slot: number): boolean {
  const cols = world.vehicles.cols;
  return cols.speed[slot] === 0 && track.boundariesQ8.includes(cols.trackPos[slot]);
}

/** True when no train of the ride has any car in the station's block zone. */
export function stationZoneClear(world: World, track: VehicleTrack): boolean {
  if (track.stationEndQ8 < 0) return true;
  return !otherTrainInZone(world, track, -1, zoneOf(track, track.stationEndQ8));
}

function brakingSpeed(decelQ8: number, roomQ8: number): number {
  return roomQ8 <= 0 ? 0 : integerSqrt(2 * decelQ8 * roomQ8);
}

/**
 * Pseudo-random fraction (0..1023 over 1024) that rounds friction without bias: speeds are whole
 * Q8 units, so friction below one unit per tick would otherwise vanish. Deterministic in
 * (tick, train, slice).
 */
function frictionDither(tick: number, slot: number, slice: number): number {
  const mixed = Math.imul(tick + 1, 0x9e3779b1) ^ Math.imul(slot * 31 + slice + 1, 0x85ebca6b);
  return (mixed >>> 22) & 1023;
}

/** Speed change over `timeQ8` of the whole-unit driving accelerations and fractional friction. */
function speedChange(
  drivingQ8: number,
  frictionQ10: number,
  timeQ8: number,
  dither: number,
): number {
  const driven = Math.trunc((drivingQ8 * timeQ8) / Q8);
  const lost = Math.floor((frictionQ10 * timeQ8 + dither) / (Q8 * FRICTION_SCALE));
  return driven - lost;
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
    if (cols.state[slot] === VehicleState.Testing) {
      completeTestAtStation(world, track, slot, segment);
      return false;
    }
    cols.state[slot] = VehicleState.Arriving;
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

/** Ends a test lap at the start of a station segment and records the run's ratings. */
function completeTestAtStation(
  world: World,
  track: VehicleTrack,
  slot: number,
  segment: number,
): void {
  const cols = world.vehicles.cols;
  const point = segment * 3;
  cols.x[slot] = track.points[point];
  cols.y[slot] = track.points[point + 1];
  cols.z[slot] = track.points[point + 2];
  cols.trackPos[slot] = track.cumulativeLengthsQ8[segment];
  cols.speed[slot] = 0;
  cols.lastSegment[slot] = segment;
  cols.dispatchTicks[slot] = 0;
  cols.state[slot] = VehicleState.TestComplete;
  updateRideTestStats(world, slot);
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
  } else if (
    state !== VehicleState.Running &&
    state !== VehicleState.Testing &&
    state !== VehicleState.Arriving
  ) {
    return;
  }

  const testing = cols.state[slot] === VehicleState.Testing;
  const position = Math.max(0, cols.trackPos[slot]);
  let segment = segmentAt(track, position);
  let speed = cols.speed[slot];
  cols.maxSpeed[slot] = Math.min(0xffff, Math.max(cols.maxSpeed[slot], speed));
  if (cols.lastSegment[slot] !== segment && !enterSegment(world, track, slot, segment, speed))
    return;

  const arriving = cols.state[slot] === VehicleState.Arriving;
  let stop = -1;
  if (arriving) stop = track.stationEndQ8;
  else if (cols.state[slot] === VehicleState.Running) stop = holdTarget(world, track, slot);
  if (
    stop < 0 &&
    speed === 0 &&
    cols.state[slot] === VehicleState.Running &&
    position !== track.stationEndQ8 &&
    track.boundariesQ8.includes(position)
  ) {
    // A block brake lets a held train go at crawl speed once the zone ahead is clear.
    speed = OPEN_BLOCK_SPEED_Q8;
  }
  if (stop >= 0) {
    const limit = brakingSpeed(
      arriving ? STATION_BRAKE_DECEL_Q8 : HOLD_BRAKE_DECEL_Q8,
      stop - position,
    );
    speed = Math.min(speed, limit);
    if (arriving) speed = Math.max(speed, Math.min(ARRIVAL_CREEP_Q8, limit));
  }

  const cars = Math.max(1, cols.carCount[slot]);
  const mass = Math.max(64, cols.mass[slot] + cols.passengers[slot] * PASSENGER_MASS);
  const rollingFriction = Math.max(1, Math.trunc((ROLLING_FRICTION_Q10_AT_1024 * 1024) / mass));
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
    const flags = trainFlags(track, cars, nextPosition, segment);
    const driving = trainSlopeAcceleration(track, cars, nextPosition, segment) - speedDrag;
    const dither = frictionDither(world.tick, slot, guard);
    let segmentEndSpeed = Math.max(
      0,
      currentSpeed + speedChange(driving, rollingFriction, timeRemaining, dither),
    );
    segmentEndSpeed = controlSpeed(flags, segmentEndSpeed, timeRemaining, arriving);
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
    currentSpeed = Math.max(
      0,
      currentSpeed + speedChange(driving, rollingFriction, timeToBoundary, dither),
    );
    currentSpeed = controlSpeed(flags, currentSpeed, timeToBoundary, arriving);
    cols.maxSpeed[slot] = Math.min(0xffff, Math.max(cols.maxSpeed[slot], currentSpeed));
    nextPosition = boundary;
    timeRemaining -= timeToBoundary;
    if (testing) airtime ||= sampleForces(world, track, slot, segment, currentSpeed);
    if (nextPosition >= track.totalLengthQ8) break;

    const enteredSegment = segment + 1;
    const enteredFlags = track.segmentFlags[enteredSegment];
    const section = track.blockSectionStart[enteredSegment];
    const occupant = track.blockOccupiedBy[section];
    if (
      enteredFlags & VehicleSegmentFlag.Block &&
      (track.blockOpen[enteredSegment] === 0 || (occupant !== -1 && occupant !== slot))
    ) {
      currentSpeed = 0;
      break;
    }
    segment = enteredSegment;
    if (enteredFlags & VehicleSegmentFlag.Block) track.blockOccupiedBy[section] = slot;
    if (!enterSegment(world, track, slot, segment, currentSpeed)) return;
  }
  nextPosition = Math.min(nextPosition, track.totalLengthQ8);
  let nextSpeed = currentSpeed;
  cols.maxSpeed[slot] = Math.min(0xffff, Math.max(cols.maxSpeed[slot], nextSpeed));

  let stopped = false;
  if (stop >= 0 && stop <= track.totalLengthQ8 && position <= stop && nextPosition >= stop) {
    nextPosition = stop;
    nextSpeed = 0;
    stopped = true;
  }

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

  if (stopped && arriving) {
    cols.trackPos[slot] = stop >= track.totalLengthQ8 ? 0 : stop;
    cols.state[slot] = VehicleState.Unloading;
    cols.dispatchTicks[slot] = 0;
    cols.lastSegment[slot] = track.stationEndSegment - 1;
    return;
  }

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
      if (!testing && track.stationSegment === 0 && !arriving) {
        cols.state[slot] = VehicleState.Arriving;
      }
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
    const moving =
      state === VehicleState.Running ||
      state === VehicleState.Testing ||
      state === VehicleState.Arriving;
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
        cols.state[other] !== VehicleState.Testing &&
        cols.state[other] !== VehicleState.Arriving
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
