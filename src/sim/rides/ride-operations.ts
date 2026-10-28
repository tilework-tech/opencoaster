import type { World } from '../core/world';
import { Surface } from '../map/tile-map';
import { maxCarsForRide, maxTrainsForRide, RIDERS_PER_CAR } from '../vehicles/ride-trains';
import { LOAD_TARGET_THRESHOLD, LoadTarget } from './ride-modes';
import { RideMode } from './ride-modes';
import { RELIABILITY_MAX } from './ride-maintenance';
import { rideFootprintTiles } from './ride-footprint';
import {
  INSPECTION_INTERVAL_MINUTES,
  INSPECTION_MINUTE_TICKS,
  RIDE_CATALOG,
  type RideType,
} from './ride-types';
import { RidePhase, RideState } from './ride-store';
import { RideResult } from './ride-results';
import {
  SAME_TYPE_VALUE_PERCENT,
  rideAgeAdjustedValue,
  rideValueUnits,
  valueUnitsToCents,
} from './ride-value';

const TICKS_PER_MONTH = 16_384;
export const QUEUE_GUESTS_PER_TILE = 4;

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
  /** One of the five documented load targets; takes precedence over `loadThreshold`. */
  loadTarget?: LoadTarget;
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

export function createRide(world: World, type: RideType, x: number, y: number, dir = 0): number {
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
  ride.dir[slot] = dir & 3;
  ride.capacity[slot] = definition.capacity;
  ride.loadTicks[slot] = definition.loadTicks;
  ride.runTicks[slot] = definition.runTicks;
  ride.unloadTicks[slot] = definition.unloadTicks;
  ride.minWaitTicks[slot] = definition.loadTicks;
  ride.maxWaitTicks[slot] = Math.max(definition.loadTicks, definition.loadTicks * 4);
  ride.loadThreshold[slot] = LOAD_TARGET_THRESHOLD[LoadTarget.Half];
  ride.mode[slot] = definition.modes[0].mode;
  applyRideModeRatings(world, slot);
  ride.price[slot] = definition.defaultPriceCents;
  ride.reliabilityRaw[slot] = RELIABILITY_MAX;
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
  const tiles = rideFootprintTiles(definition, ride.rideX[slot], ride.rideY[slot], ride.dir[slot]);
  const adjacentToFootprint = (position: TilePosition): boolean =>
    tiles.some(([x, y]) => Math.abs(position.x - x) + Math.abs(position.y - y) === 1) &&
    !tiles.some(([x, y]) => position.x === x && position.y === y);
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
  if (options.loadTarget !== undefined && !(options.loadTarget in LOAD_TARGET_THRESHOLD)) {
    return false;
  }
  const threshold =
    options.loadTarget !== undefined
      ? LOAD_TARGET_THRESHOLD[options.loadTarget]
      : (options.loadThreshold ?? ride.loadThreshold[slot]);
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

/**
 * Guests a ride's line can hold. A built queue holds four guests per queue tile single file, the
 * entrance tile included; a ride entered straight from a path counts its declared tiles.
 */
export function rideQueueCapacity(world: World, slot: number): number {
  const ride = world.rides.cols;
  const limit = ride.queueLimit[slot];
  const built = world.queues.hasQueue[slot]
    ? (world.queues.tiles[slot] + 1) * QUEUE_GUESTS_PER_TILE
    : (ride.queueLineTiles[slot] + 1) * QUEUE_GUESTS_PER_TILE;
  return limit > 0 && limit < built ? limit : built;
}

/** Sets the longest line the ride accepts, in guests; 0 lifts the limit. */
export function setRideQueueLimit(world: World, rideId: number, limit: number): boolean {
  const slot = slotForRide(world, rideId);
  if (slot < 0 || !inRangeInteger(limit, 0, 0xffff)) return false;
  world.rides.cols.queueLimit[slot] = limit;
  return true;
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

/**
 * Sets how many trains a coaster runs and how many cars each has (0 for either means automatic).
 * Riders per train follow from the cars, so the ride's capacity per dispatch is set with them.
 * Only a closed ride can change; cars must fit the station platform and trains the block sections.
 * A closed, tested ride re-parks its train with the new car count on the next tick.
 */
export function setTrainLayout(
  world: World,
  rideId: number,
  trains: number,
  cars: number,
): RideResult {
  const slot = slotForRide(world, rideId);
  if (slot < 0) return RideResult.NoSuchRide;
  const cols = world.rides.cols;
  const definition = RIDE_CATALOG[cols.typeId[slot] as RideType];
  if (!definition.usesTrack) return RideResult.NotTrackRide;
  if (cols.state[slot] !== RideState.Closed || isRideInActiveCycle(cols.phase[slot])) {
    return RideResult.Busy;
  }
  if (!inRangeInteger(trains, 0, maxTrainsForRide(world, rideId))) return RideResult.Blocked;
  if (!inRangeInteger(cars, 0, maxCarsForRide(world, rideId))) return RideResult.Blocked;
  cols.trainCount[slot] = trains;
  cols.carsPerTrain[slot] = cars;
  cols.capacity[slot] = cars === 0 ? definition.capacity : cars * RIDERS_PER_CAR;
  return RideResult.Ok;
}

export function setRidePrice(world: World, rideId: number, priceCents: number): boolean {
  const slot = slotForRide(world, rideId);
  if (slot < 0 || !inRangeInteger(priceCents, 0, 0xffff)) return false;
  world.rides.cols.price[slot] = priceCents;
  return true;
}

export function addRideIncome(world: World, rideSlot: number, cents: number): void {
  const income = world.rides.cols.incomeCents;
  income[rideSlot] = Math.min(0x7fff_ffff, income[rideSlot] + cents);
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
  if (!definition || isShopCategory(definition.category)) return 0;

  const rating = rideValueUnits(
    {
      excitement: ride.excitement[slot],
      intensity: ride.intensity[slot],
      nausea: ride.nausea[slot],
    },
    definition.valueWeights,
  );
  let units = rideAgeAdjustedValue(rating, ride.ageMonths[slot]);
  if (openRidesOfType(world, ride.typeId[slot]) >= 2) {
    units = Math.floor((units * SAME_TYPE_VALUE_PERCENT) / 100);
  }
  return valueUnitsToCents(units);
}

function openRidesOfType(world: World, typeId: number): number {
  const ride = world.rides.cols;
  let open = 0;
  for (let slot = 0; slot < world.rides.count; slot++) {
    if (ride.typeId[slot] === typeId && ride.state[slot] === RideState.Open) open++;
  }
  return open;
}

export type RidePriceReaction = 'good-value' | 'fair-value' | 'too-expensive';

/** Good value at up to half the ride's value, too expensive beyond twice it. */
export function getRidePriceReaction(world: World, rideId: number): RidePriceReaction {
  const slot = slotForRide(world, rideId);
  if (slot < 0) return 'too-expensive';
  const price = world.rides.cols.price[slot];
  const value = getRideValueCents(world, rideId);
  if (price * 2 <= value) return 'good-value';
  if (price <= value * 2) return 'fair-value';
  return 'too-expensive';
}

export function getRidePhase(world: World, rideId: number): RidePhase | undefined {
  const slot = slotForRide(world, rideId);
  return slot < 0 ? undefined : (world.rides.cols.phase[slot] as RidePhase);
}

export function getRideType(world: World, rideId: number): RideType | undefined {
  const slot = slotForRide(world, rideId);
  return slot < 0 ? undefined : (world.rides.cols.typeId[slot] as RideType);
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

/** Ticks a guest joining the line now would wait: the whole line (queuing and waiting) divided into trips. */
export function estimatedWaitTicks(world: World, slot: number): number {
  const ride = world.rides.cols;
  const serviceTicks = ride.loadTicks[slot] + ride.runTicks[slot] + ride.unloadTicks[slot];
  const line = Math.max(ride.queueLength[slot], world.rideLines.queued[slot]);
  return ride.capacity[slot] === 0 ? 0 : Math.floor((line * serviceTicks) / ride.capacity[slot]);
}

export function getEstimatedRideWaitTicks(world: World, rideId: number): number {
  const slot = slotForRide(world, rideId);
  return slot < 0 ? 0 : estimatedWaitTicks(world, slot);
}

export function isRideInspectionDue(world: World, rideId: number): boolean {
  const slot = slotForRide(world, rideId);
  if (slot < 0) return false;
  const ride = world.rides.cols;
  const interval = ride.inspectionIntervalTicks[slot];
  if (interval === 0 || RIDE_CATALOG[ride.typeId[slot] as RideType]?.breakdowns.length === 0) {
    return false;
  }
  return world.tick - ride.lastInspectionTick[slot] >= interval;
}

export function updateRideAge(world: World): void {
  const rides = world.rides.cols;
  for (let slot = 0; slot < world.rides.count; slot++) {
    rides.ageMonths[slot] = Math.floor((world.tick - rides.createdTick[slot]) / TICKS_PER_MONTH);
  }
}

/** Recomputes a flat ride's stored ratings from its type's base ratings and its current mode. */
export function applyRideModeRatings(world: World, slot: number): void {
  const ride = world.rides.cols;
  const definition = RIDE_CATALOG[ride.typeId[slot] as RideType];
  const mode =
    definition.modes.find((entry) => entry.mode === ride.mode[slot]) ?? definition.modes[0];
  ride.excitement[slot] = Math.max(0, definition.baseExcitement + mode.excitement);
  ride.intensity[slot] = Math.max(0, definition.baseIntensity + mode.intensity);
  ride.nausea[slot] = Math.max(0, definition.baseNausea + mode.nausea);
}

export function getRideMode(world: World, rideId: number): RideMode | undefined {
  const slot = slotForRide(world, rideId);
  return slot < 0 ? undefined : (world.rides.cols.mode[slot] as RideMode);
}

/**
 * Selects one of the modes the ride's type offers. Only a closed, idle ride changes mode; a
 * flat ride's ratings follow the mode, while a track ride keeps the ratings its test measured.
 */
export function setRideMode(world: World, rideId: number, mode: RideMode): boolean {
  const slot = slotForRide(world, rideId);
  if (slot < 0) return false;
  const ride = world.rides.cols;
  const definition = RIDE_CATALOG[ride.typeId[slot] as RideType];
  if (
    !definition.modes.some((entry) => entry.mode === mode) ||
    ride.state[slot] === RideState.Open ||
    ride.state[slot] === RideState.Testing ||
    isRideInActiveCycle(ride.phase[slot])
  ) {
    return false;
  }
  ride.mode[slot] = mode;
  if (!definition.usesTrack) applyRideModeRatings(world, slot);
  return true;
}

/**
 * Block brakes only separate trains in block-sectioned mode, so placing one moves a ride that
 * offers the mode into it.
 */
export function enableBlockSections(world: World, rideId: number): void {
  if (getRideMode(world, rideId) === RideMode.ContinuousCircuit)
    setRideMode(world, rideId, RideMode.ContinuousCircuitBlockSectioned);
}

/** Sets how often a mechanic inspects the ride: one of the listed minutes, or 0 for never. */
export function setRideInspectionInterval(world: World, rideId: number, minutes: number): boolean {
  const slot = slotForRide(world, rideId);
  const allowed =
    minutes === 0 || (INSPECTION_INTERVAL_MINUTES as readonly number[]).includes(minutes);
  if (slot < 0 || !allowed) return false;
  world.rides.cols.inspectionIntervalTicks[slot] = minutes * INSPECTION_MINUTE_TICKS;
  return true;
}
