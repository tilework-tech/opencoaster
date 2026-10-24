import type { World } from '../core/world';
import { Surface } from '../map/tile-map';
import { StaffKind } from '../staff/staff-store';
import { RIDE_CATALOG, type RideType } from './ride-types';
import { RidePhase, RideState } from './ride-store';

const TICKS_PER_MONTH = 16_384;
export const QUEUE_GUESTS_PER_TILE = 4;
const MAX_RIDE_VALUE_AGE_MONTHS = 12;
const AGE_VALUE_DEPRECIATION_PERCENT = 5;

export interface TilePosition {
  x: number;
  y: number;
}

export interface RideRatings {
  excitement: number;
  intensity: number;
  nausea: number;
}

export interface RideTestMeasurements {
  durationTicks: number;
  maxSpeed: number;
  /** G values are signed Q8 integers, with 256 representing one G. */
  maxPositiveG: number;
  maxNegativeG: number;
  maxLateralG: number;
  dropCount: number;
  highestDrop: number;
  inversionCount: number;
}

export interface RideOperations {
  minWaitTicks?: number;
  maxWaitTicks?: number;
  /** 0 dispatches with any nonempty load; 255 waits for a full load. */
  loadThreshold?: number;
  loadTicks?: number;
  runTicks?: number;
  unloadTicks?: number;
}

function isFootpathSurface(surface: number): boolean {
  return surface === Surface.Path || surface === Surface.Queue;
}

/** Stalls and facilities are used at their entrance tile and need no queue line or exit. */
export function isShopCategory(category: string): boolean {
  return category === 'stall' || category === 'facility';
}

function slotForRide(world: World, rideId: number): number {
  return world.rides.idToSlot[rideId] ?? -1;
}

function inRangeInteger(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isRideInActiveCycle(phase: number): boolean {
  return (
    phase === RidePhase.Loading || phase === RidePhase.Running || phase === RidePhase.Unloading
  );
}

export function createRide(world: World, type: RideType, x: number, y: number): number {
  const definition = RIDE_CATALOG[type];
  if (!definition || !world.map.inBounds(x, y)) return -1;
  const slot = world.rides.spawn();
  if (slot < 0) return -1;

  const ride = world.rides.cols;
  ride.typeId[slot] = type;
  ride.state[slot] = RideState.Closed;
  ride.phase[slot] = RidePhase.Closed;
  ride.rideX[slot] = x;
  ride.rideY[slot] = y;
  ride.capacity[slot] = definition.capacity;
  ride.loadTicks[slot] = definition.loadTicks;
  ride.runTicks[slot] = definition.runTicks;
  ride.unloadTicks[slot] = definition.unloadTicks;
  ride.minWaitTicks[slot] = definition.loadTicks;
  ride.maxWaitTicks[slot] = Math.max(definition.loadTicks, definition.loadTicks * 4);
  ride.loadThreshold[slot] = 128;
  ride.excitement[slot] = definition.baseExcitement;
  ride.intensity[slot] = definition.baseIntensity;
  ride.nausea[slot] = definition.baseNausea;
  ride.price[slot] = definition.category === 'stall' ? 100 : 0;
  ride.reliability[slot] = 100;
  ride.inspectionIntervalTicks[slot] = definition.inspectionIntervalTicks;
  ride.lastInspectionTick[slot] = world.tick;
  ride.createdTick[slot] = world.tick;
  ride.ageMonths[slot] = 0;
  ride.entranceX[slot] = x;
  ride.entranceY[slot] = y;
  return world.rides.slotToId[slot];
}

export function placeRideEntranceExit(
  world: World,
  rideId: number,
  entrance: TilePosition,
  exit: TilePosition,
): boolean {
  const slot = slotForRide(world, rideId);
  if (
    slot < 0 ||
    world.rides.cols.state[slot] === RideState.Open ||
    isRideInActiveCycle(world.rides.cols.phase[slot])
  ) {
    return false;
  }
  if (!world.map.inBounds(entrance.x, entrance.y) || !world.map.inBounds(exit.x, exit.y)) {
    return false;
  }
  if (entrance.x === exit.x && entrance.y === exit.y) return false;

  const ride = world.rides.cols;
  const definition = RIDE_CATALOG[ride.typeId[slot] as RideType];
  const adjacentToFootprint = (position: TilePosition): boolean =>
    definition.footprint.some(([dx, dy]) => {
      const x = ride.rideX[slot] + dx;
      const y = ride.rideY[slot] + dy;
      return Math.abs(position.x - x) + Math.abs(position.y - y) === 1;
    });
  if (!adjacentToFootprint(entrance) || !adjacentToFootprint(exit)) return false;
  ride.entranceX[slot] = entrance.x;
  ride.entranceY[slot] = entrance.y;
  ride.exitX[slot] = exit.x;
  ride.exitY[slot] = exit.y;
  ride.entrancePlaced[slot] = 1;
  ride.exitPlaced[slot] = 1;
  ride.queueConnected[slot] = 0;
  ride.queueLineTiles[slot] = 0;
  return true;
}

export function connectRideQueue(
  world: World,
  rideId: number,
  tiles: readonly TilePosition[],
): boolean {
  const slot = slotForRide(world, rideId);
  if (
    slot < 0 ||
    world.rides.cols.entrancePlaced[slot] === 0 ||
    world.rides.cols.state[slot] === RideState.Open ||
    tiles.length < 2 ||
    isRideInActiveCycle(world.rides.cols.phase[slot])
  ) {
    return false;
  }
  const ride = world.rides.cols;
  if (tiles[0].x !== ride.entranceX[slot] || tiles[0].y !== ride.entranceY[slot]) return false;

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    if (!world.map.inBounds(tile.x, tile.y)) return false;
    if (i > 0) {
      const previous = tiles[i - 1];
      if (Math.abs(tile.x - previous.x) + Math.abs(tile.y - previous.y) !== 1) return false;
      for (let j = 0; j < i; j++) {
        if (tiles[j].x === tile.x && tiles[j].y === tile.y) return false;
      }
    }
    if (i > 0 && !isFootpathSurface(world.map.surface[world.map.index(tile.x, tile.y)])) {
      return false;
    }
  }

  const endpoint = tiles[tiles.length - 1];
  if (!isFootpathSurface(world.map.surface[world.map.index(endpoint.x, endpoint.y)])) return false;
  const queueLineTiles = Math.min(Math.max(0, tiles.length - 2), 0xffff);
  if (ride.queueLength[slot] > queueLineTiles * QUEUE_GUESTS_PER_TILE) return false;
  ride.queueConnected[slot] = 1;
  ride.queueLineTiles[slot] = queueLineTiles;
  return true;
}

export function setRideOpen(world: World, rideId: number, open: boolean): boolean {
  const slot = slotForRide(world, rideId);
  if (slot < 0) return false;
  const ride = world.rides.cols;

  if (!open) {
    if (ride.state[slot] === RideState.Broken || ride.phase[slot] === RidePhase.Broken) {
      ride.state[slot] = RideState.Broken;
      return true;
    }
    ride.state[slot] = RideState.Closed;
    if (ride.phase[slot] === RidePhase.Waiting || ride.phase[slot] === RidePhase.Closed) {
      ride.phase[slot] = RidePhase.Closed;
      ride.phaseTicks[slot] = 0;
      ride.waitTicks[slot] = 0;
    }
    return true;
  }

  const definition = RIDE_CATALOG[ride.typeId[slot] as RideType];
  const shop = isShopCategory(definition.category);
  if (
    ride.state[slot] === RideState.Broken ||
    ride.phase[slot] === RidePhase.Broken ||
    isRideInActiveCycle(ride.phase[slot]) ||
    ride.entrancePlaced[slot] === 0 ||
    (!shop && (ride.exitPlaced[slot] === 0 || ride.queueConnected[slot] === 0)) ||
    (definition.usesTrack && ride.tested[slot] === 0)
  ) {
    return false;
  }
  ride.state[slot] = RideState.Open;
  ride.phase[slot] = RidePhase.Waiting;
  ride.phaseTicks[slot] = 0;
  ride.waitTicks[slot] = 0;
  return true;
}

export function configureRide(world: World, rideId: number, options: RideOperations): boolean {
  const slot = slotForRide(world, rideId);
  if (
    slot < 0 ||
    world.rides.cols.state[slot] === RideState.Open ||
    isRideInActiveCycle(world.rides.cols.phase[slot])
  ) {
    return false;
  }
  const ride = world.rides.cols;
  const minWait = options.minWaitTicks ?? ride.minWaitTicks[slot];
  const maxWait = options.maxWaitTicks ?? ride.maxWaitTicks[slot];
  const threshold = options.loadThreshold ?? ride.loadThreshold[slot];
  const loadTicks = options.loadTicks ?? ride.loadTicks[slot];
  const runTicks = options.runTicks ?? ride.runTicks[slot];
  const unloadTicks = options.unloadTicks ?? ride.unloadTicks[slot];
  if (
    !inRangeInteger(minWait, 0, 0xffff) ||
    !inRangeInteger(maxWait, minWait, 0xffff) ||
    !inRangeInteger(threshold, 0, 0xff) ||
    !inRangeInteger(loadTicks, 0, 0xffff) ||
    !inRangeInteger(runTicks, 1, 0xffff) ||
    !inRangeInteger(unloadTicks, 0, 0xffff)
  ) {
    return false;
  }

  ride.minWaitTicks[slot] = minWait;
  ride.maxWaitTicks[slot] = maxWait;
  ride.loadThreshold[slot] = threshold;
  ride.loadTicks[slot] = loadTicks;
  ride.runTicks[slot] = runTicks;
  ride.unloadTicks[slot] = unloadTicks;
  return true;
}

/** Guests a ride's line can hold: its queue tiles plus the entrance tile itself. */
export function rideQueueCapacity(world: World, slot: number): number {
  return (world.rides.cols.queueLineTiles[slot] + 1) * QUEUE_GUESTS_PER_TILE;
}

export function joinRideQueue(world: World, rideId: number, guests: number): boolean {
  const slot = slotForRide(world, rideId);
  if (
    slot < 0 ||
    world.rides.cols.state[slot] !== RideState.Open ||
    world.rides.cols.queueConnected[slot] === 0 ||
    !inRangeInteger(guests, 1, 0xffff)
  ) {
    return false;
  }
  const ride = world.rides.cols;
  const capacity = ride.queueLineTiles[slot] * QUEUE_GUESTS_PER_TILE;
  if (ride.queueLength[slot] + guests > capacity) return false;
  ride.queueLength[slot] += guests;
  return true;
}

export function leaveRideQueue(world: World, rideId: number, guests: number): boolean {
  const slot = slotForRide(world, rideId);
  if (slot < 0 || !inRangeInteger(guests, 1, 0xffff)) return false;
  const ride = world.rides.cols;
  if (guests > ride.queueLength[slot]) return false;
  ride.queueLength[slot] -= guests;
  return true;
}

export function setRidePrice(world: World, rideId: number, priceCents: number): boolean {
  const slot = slotForRide(world, rideId);
  if (slot < 0 || !inRangeInteger(priceCents, 0, 0xffff)) return false;
  world.rides.cols.price[slot] = priceCents;
  return true;
}

export function getRideRatings(world: World, rideId: number): RideRatings {
  const slot = slotForRide(world, rideId);
  if (slot < 0) return { excitement: 0, intensity: 0, nausea: 0 };
  return {
    excitement: world.rides.cols.excitement[slot],
    intensity: world.rides.cols.intensity[slot],
    nausea: world.rides.cols.nausea[slot],
  };
}

export function getRideAgeMonths(world: World, rideId: number): number {
  const slot = slotForRide(world, rideId);
  return slot < 0 ? 0 : world.rides.cols.ageMonths[slot];
}

export function getRideValueCents(world: World, rideId: number): number {
  const slot = slotForRide(world, rideId);
  if (slot < 0) return 0;
  const ride = world.rides.cols;
  const definition = RIDE_CATALOG[ride.typeId[slot] as RideType];
  if (!definition || definition.category === 'stall' || definition.category === 'facility')
    return 0;

  const ratingPercent = Math.max(
    50,
    Math.min(
      150,
      100 +
        Math.floor(ride.excitement[slot] / 10) -
        Math.floor(ride.intensity[slot] / 20) -
        Math.floor(ride.nausea[slot] / 40),
    ),
  );
  const ageMonths = Math.min(ride.ageMonths[slot], MAX_RIDE_VALUE_AGE_MONTHS);
  const agePercent = 100 - ageMonths * AGE_VALUE_DEPRECIATION_PERCENT;
  return Math.floor((definition.baseValueCents * ratingPercent * agePercent) / 10_000);
}

export type RidePriceReaction = 'good-value' | 'fair-value' | 'too-expensive';

export function getRidePriceReaction(world: World, rideId: number): RidePriceReaction {
  const slot = slotForRide(world, rideId);
  if (slot < 0) return 'too-expensive';
  const price = world.rides.cols.price[slot];
  const value = getRideValueCents(world, rideId);
  if (price * 2 <= value) return 'good-value';
  if (price <= value) return 'fair-value';
  return 'too-expensive';
}

export function getRidePhase(world: World, rideId: number): RidePhase | undefined {
  const slot = slotForRide(world, rideId);
  return slot < 0 ? undefined : (world.rides.cols.phase[slot] as RidePhase);
}

export function getRideCapacity(world: World, rideId: number): number {
  const slot = slotForRide(world, rideId);
  return slot < 0 ? 0 : world.rides.cols.capacity[slot];
}

export function getRideQueueLength(world: World, rideId: number): number {
  const slot = slotForRide(world, rideId);
  return slot < 0 ? 0 : world.rides.cols.queueLength[slot];
}

export function getRideBoardedCount(world: World, rideId: number): number {
  const slot = slotForRide(world, rideId);
  return slot < 0 ? 0 : world.rides.cols.boarded[slot];
}

export function getRideGuestsServed(world: World, rideId: number): number {
  const slot = slotForRide(world, rideId);
  return slot < 0 ? 0 : world.rides.cols.guestsServed[slot];
}

export function getRideReliability(world: World, rideId: number): number {
  const slot = slotForRide(world, rideId);
  return slot < 0 ? 0 : world.rides.cols.reliability[slot];
}

export function getRideDowntimeTicks(world: World, rideId: number): number {
  const slot = slotForRide(world, rideId);
  return slot < 0 ? 0 : world.rides.cols.downtimeTicks[slot];
}

export function isRideTested(world: World, rideId: number): boolean {
  const slot = slotForRide(world, rideId);
  return slot >= 0 && world.rides.cols.tested[slot] !== 0;
}

export function recordRideTestMeasurements(
  world: World,
  rideId: number,
  measurements: RideTestMeasurements,
): boolean {
  const slot = slotForRide(world, rideId);
  if (slot < 0) return false;
  if (
    !inRangeInteger(measurements.durationTicks, 1, 0xffffffff) ||
    !inRangeInteger(measurements.maxSpeed, 0, 0x7fffffff) ||
    !inRangeInteger(measurements.maxPositiveG, 0, 0x7fffffff) ||
    !inRangeInteger(measurements.maxNegativeG, -0x80000000, 0) ||
    !inRangeInteger(measurements.maxLateralG, 0, 0x7fffffff) ||
    !inRangeInteger(measurements.dropCount, 0, 0xffff) ||
    !inRangeInteger(measurements.highestDrop, 0, 0x7fffffff) ||
    !inRangeInteger(measurements.inversionCount, 0, 0xffff)
  ) {
    return false;
  }
  const ride = world.rides.cols;
  ride.testDurationTicks[slot] = measurements.durationTicks;
  ride.testMaxSpeed[slot] = measurements.maxSpeed;
  ride.testMaxPositiveG[slot] = measurements.maxPositiveG;
  ride.testMaxNegativeG[slot] = measurements.maxNegativeG;
  ride.testMaxLateralG[slot] = measurements.maxLateralG;
  ride.testDropCount[slot] = measurements.dropCount;
  ride.testHighestDrop[slot] = measurements.highestDrop;
  ride.testInversionCount[slot] = measurements.inversionCount;
  ride.tested[slot] = 1;
  return true;
}

export function getRideTestMeasurements(world: World, rideId: number): RideTestMeasurements | null {
  const slot = slotForRide(world, rideId);
  if (slot < 0 || world.rides.cols.tested[slot] === 0) return null;
  const ride = world.rides.cols;
  return {
    durationTicks: ride.testDurationTicks[slot],
    maxSpeed: ride.testMaxSpeed[slot],
    maxPositiveG: ride.testMaxPositiveG[slot],
    maxNegativeG: ride.testMaxNegativeG[slot],
    maxLateralG: ride.testMaxLateralG[slot],
    dropCount: ride.testDropCount[slot],
    highestDrop: ride.testHighestDrop[slot],
    inversionCount: ride.testInversionCount[slot],
  };
}

export function triggerRideBreakdown(world: World, rideId: number): boolean {
  const slot = slotForRide(world, rideId);
  if (slot < 0 || world.rides.cols.state[slot] !== RideState.Open) return false;
  const ride = world.rides.cols;
  ride.state[slot] = RideState.Broken;
  ride.reliability[slot] = Math.max(0, ride.reliability[slot] - 20);
  ride.breakdownCounter[slot]++;
  if (ride.phase[slot] === RidePhase.Waiting || ride.phase[slot] === RidePhase.Closed) {
    ride.phase[slot] = RidePhase.Broken;
    ride.phaseTicks[slot] = 0;
  }
  return true;
}

export function inspectRide(world: World, rideId: number, staffId: number): boolean {
  const slot = slotForRide(world, rideId);
  const mechanicSlot = world.staff.idToSlot[staffId] ?? -1;
  if (
    slot < 0 ||
    mechanicSlot < 0 ||
    world.staff.cols.kind[mechanicSlot] !== StaffKind.Mechanic ||
    isRideInActiveCycle(world.rides.cols.phase[slot])
  ) {
    return false;
  }
  const ride = world.rides.cols;
  ride.reliability[slot] = Math.min(100, ride.reliability[slot] + 25);
  ride.lastInspectionTick[slot] = world.tick;
  if (ride.phase[slot] === RidePhase.Broken) {
    ride.state[slot] = ride.queueConnected[slot] ? RideState.Open : RideState.Closed;
    ride.phase[slot] = ride.queueConnected[slot] ? RidePhase.Waiting : RidePhase.Closed;
  }
  return true;
}

export function calculateRideThroughputPerHour(
  capacityPerDispatch: number,
  loadTicks: number,
  runTicks: number,
  unloadTicks: number,
): number {
  const cycleTicks = loadTicks + runTicks + unloadTicks;
  if (
    !inRangeInteger(capacityPerDispatch, 0, 0xffff) ||
    !inRangeInteger(loadTicks, 0, 0xffffffff) ||
    !inRangeInteger(runTicks, 0, 0xffffffff) ||
    !inRangeInteger(unloadTicks, 0, 0xffffffff) ||
    cycleTicks === 0
  ) {
    return 0;
  }
  return Math.floor((capacityPerDispatch * 40 * 60 * 60) / cycleTicks);
}

export function getEstimatedRideWaitTicks(world: World, rideId: number): number {
  const slot = slotForRide(world, rideId);
  if (slot < 0) return 0;
  const ride = world.rides.cols;
  const serviceTicks = ride.loadTicks[slot] + ride.runTicks[slot] + ride.unloadTicks[slot];
  return ride.capacity[slot] === 0
    ? 0
    : Math.floor((ride.queueLength[slot] * serviceTicks) / ride.capacity[slot]);
}

export function isRideInspectionDue(world: World, rideId: number): boolean {
  const slot = slotForRide(world, rideId);
  if (slot < 0) return false;
  const ride = world.rides.cols;
  return world.tick - ride.lastInspectionTick[slot] >= ride.inspectionIntervalTicks[slot];
}

export function updateRideAge(world: World): void {
  const rides = world.rides.cols;
  for (let slot = 0; slot < world.rides.count; slot++) {
    rides.ageMonths[slot] = Math.floor((world.tick - rides.createdTick[slot]) / TICKS_PER_MONTH);
  }
}
