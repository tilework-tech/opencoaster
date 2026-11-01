import { refreshQueueIndex } from './queue-lines';
import { heightCapDetail } from '../scenario/restrictions';
import { popcount4 } from '../pathfinding/directions';
import type { World } from '../core/world';
import { TILE_UNITS, Z_STEP } from '../core/constants';
import { FeedbackDomain, reportFeedback } from '../core/feedback';
import { charge, earn } from '../economy/api';
import { LedgerCategory } from '../economy/ledger';
import { PATH_COST_CENTS, Surface } from '../map/tile-map';
import { placePath } from '../map/paths';
import { circuitStatus } from '../track/construction';
import { abortCycle, abortRideTest, isTrackRide, startRideTest } from './coaster';
import { GuestState, HEADING_NONE } from '../guests/guest-store';
import { removeRideTrains } from '../vehicles/ride-trains';
import { faceStallToward, syncAllStallFronts, syncStallFront } from './stall-front';
import {
  isShopCategory,
  setRideInspectionInterval,
  setRideMode,
  setRideOpen,
  setRidePrice,
  setRideQueueLimit,
  setObservationTowerHeight,
  setTrainLayout,
} from './ride-operations';
import type { RideMode } from './ride-modes';
import { RIDE_CATALOG } from './ride-types';
import { rideCoversTile } from './ride-footprint';
import { faceBoardingAwayFromRide, rideBoardingTiles } from './ride-boarding';
import type { RideType } from './ride-types';
import { RidePhase, RideState } from './ride-store';
import { RideResult } from './ride-results';
import { firstOccupancyBlocker, worldOccupancies } from '../map/occupancy';
import { demolitionRefund } from './ride-refund';

export type RideCommand =
  | { type: 'placeRideEntrance'; rideId: number; x: number; y: number }
  | { type: 'placeRideExit'; rideId: number; x: number; y: number }
  | { type: 'setRideStatus'; rideId: number; status: 'open' | 'close' | 'test' }
  | { type: 'setRidePrice'; rideId: number; priceCents: number; item?: number }
  | { type: 'setRideQueueLimit'; rideId: number; limit: number }
  | { type: 'setRideTrains'; rideId: number; trains: number; cars: number }
  | { type: 'setRideMode'; rideId: number; mode: RideMode }
  /** `minutes` is one of `INSPECTION_INTERVAL_MINUTES`, or 0 for never. */
  | { type: 'setRideInspection'; rideId: number; minutes: number }
  | { type: 'setObservationTowerHeight'; rideId: number; height: number }
  | { type: 'demolishRide'; rideId: number };

function rideFootprintAt(world: World, x: number, y: number): boolean {
  for (let slot = 0; slot < world.rides.count; slot++) {
    if (rideCoversTile(world, slot, x, y)) return true;
  }
  return false;
}

function isBusy(world: World, slot: number): boolean {
  const ride = world.rides.cols;
  return (
    ride.state[slot] === RideState.Open ||
    ride.state[slot] === RideState.Testing ||
    ride.phase[slot] === RidePhase.Loading ||
    ride.phase[slot] === RidePhase.Running ||
    ride.phase[slot] === RidePhase.Unloading
  );
}

/**
 * Re-reads the ride's queue line from the map: the line is connected when it has an open end on
 * an ordinary path (or the entrance is itself on a path), and its length is the queue tiles
 * behind the entrance.
 */
function connectQueueFromEntrance(world: World, slot: number): void {
  const ride = world.rides.cols;
  refreshQueueIndex(world);
  ride.queueLineTiles[slot] = world.queues.tiles[slot];
  ride.queueConnected[slot] = world.queues.joinTile[slot] >= 0 ? 1 : 0;
}

export function refreshRideQueueConnections(world: World): void {
  for (let slot = 0; slot < world.rides.count; slot++) {
    const ride = world.rides.cols;
    const def = RIDE_CATALOG[ride.typeId[slot] as RideType];
    if (def && isShopCategory(def.category)) syncStallFront(world, slot);
    else if (ride.entrancePlaced[slot]) {
      connectQueueFromEntrance(world, slot);
    }
  }
}

/** Re-reads every stall's front after the map changed under it. */
export function refreshStallFronts(world: World): void {
  syncAllStallFronts(world);
}

function findDisembarkTile(world: World, slot: number): [number, number] | null {
  const ride = world.rides.cols;
  const map = world.map;
  const candidates: [number, number][] = [];
  if (ride.exitPlaced[slot]) candidates.push([ride.exitX[slot], ride.exitY[slot]]);
  if (ride.entrancePlaced[slot]) candidates.push([ride.entranceX[slot], ride.entranceY[slot]]);
  for (const [x, y] of candidates)
    if (map.inBounds(x, y) && map.isWalkable(map.index(x, y))) return [x, y];

  let nearest: [number, number] | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!map.isWalkable(map.index(x, y))) continue;
      const candidateDistance = Math.abs(ride.rideX[slot] - x) + Math.abs(ride.rideY[slot] - y);
      if (candidateDistance < distance) {
        nearest = [x, y];
        distance = candidateDistance;
      }
    }
  }
  return nearest;
}

function placeBoardingTile(
  world: World,
  rideId: number,
  x: number,
  y: number,
  kind: 'entrance' | 'exit',
): RideResult {
  if (!world.rides.isAlive(rideId)) return RideResult.NoSuchRide;
  const slot = world.rides.idToSlot[rideId];
  const ride = world.rides.cols;
  const def = RIDE_CATALOG[ride.typeId[slot] as RideType];
  if (isShopCategory(def.category)) {
    if (kind !== 'entrance') return RideResult.Blocked;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return RideResult.OutOfBounds;
    return faceStallToward(world, slot, x, y);
  }
  if (isBusy(world, slot)) return RideResult.Busy;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !world.map.inBounds(x, y)) {
    return RideResult.OutOfBounds;
  }
  const adjacent = rideBoardingTiles(world, slot).some(
    ([bx, by]) => Math.abs(bx - x) + Math.abs(by - y) === 1,
  );
  if (!adjacent) return RideResult.NotAdjacentToStation;
  const tile = world.map.index(x, y);
  const name = `${def.name} ${rideId + 1}`;
  const base = world.map.heights[tile] * Z_STEP;
  const obstruction = firstOccupancyBlocker(
    [
      {
        tileX: x,
        tileY: y,
        base,
        clearance: base + Z_STEP,
        kind: kind === 'entrance' ? 'rideEntrance' : 'rideExit',
        name,
      },
    ],
    worldOccupancies(world),
    name,
  );
  if (obstruction) return RideResult.Blocked;
  const otherPlaced = kind === 'entrance' ? ride.exitPlaced[slot] : ride.entrancePlaced[slot];
  const otherX = kind === 'entrance' ? ride.exitX[slot] : ride.entranceX[slot];
  const otherY = kind === 'entrance' ? ride.exitY[slot] : ride.entranceY[slot];
  if (otherPlaced && otherX === x && otherY === y) return RideResult.Blocked;
  if (!world.map.canBuild(tile)) return RideResult.NotOwned;
  if (rideFootprintAt(world, x, y)) return RideResult.Blocked;

  const wanted = kind === 'entrance' ? Surface.Queue : Surface.Path;
  const surface = world.map.surface[tile];
  const alreadyRight =
    kind === 'entrance'
      ? surface === Surface.Queue
      : surface === Surface.Path || surface === Surface.Queue;
  if (kind === 'entrance' && surface === Surface.Path && popcount4(world.map.pathEdges(tile)) >= 2)
    return RideResult.CutsPath;
  if (!alreadyRight) {
    if (world.economy.cash < PATH_COST_CENTS) return RideResult.InsufficientFunds;
    if (!placePath(world.map, { x, y, queue: wanted === Surface.Queue })) return RideResult.Blocked;
    charge(world, LedgerCategory.Landscaping, PATH_COST_CENTS);
  }
  if (kind === 'entrance') {
    ride.entranceX[slot] = x;
    ride.entranceY[slot] = y;
    ride.entrancePlaced[slot] = 1;
    faceBoardingAwayFromRide(world, slot);
    connectQueueFromEntrance(world, slot);
  } else {
    ride.exitX[slot] = x;
    ride.exitY[slot] = y;
    ride.exitPlaced[slot] = 1;
    faceBoardingAwayFromRide(world, slot);
    if (ride.entrancePlaced[slot]) connectQueueFromEntrance(world, slot);
  }
  return RideResult.Ok;
}

function openRide(world: World, rideId: number): RideResult {
  if (!world.rides.isAlive(rideId)) return RideResult.NoSuchRide;
  const slot = world.rides.idToSlot[rideId];
  const ride = world.rides.cols;
  const def = RIDE_CATALOG[ride.typeId[slot] as RideType];
  if (ride.state[slot] === RideState.Broken) return RideResult.Broken;
  if (isBusy(world, slot)) return RideResult.Busy;
  const tracked = isTrackRide(world, rideId);
  if (tracked && !circuitStatus(world, rideId).complete) return RideResult.TrackIncomplete;
  if (tracked && !ride.tested[slot]) return RideResult.NotTested;
  if (!isShopCategory(def.category)) {
    if (!ride.entrancePlaced[slot]) return RideResult.NoEntrance;
    if (!ride.exitPlaced[slot]) return RideResult.NoExit;
    connectQueueFromEntrance(world, slot);
    if (!ride.queueConnected[slot]) return RideResult.NoQueue;
  }
  return setRideOpen(world, rideId, true) ? RideResult.Ok : RideResult.Busy;
}

/**
 * Closes every ride that is marked open but could not be opened now: a tracked ride that has not
 * passed a test or has no complete circuit, or any ride with no entrance. The latest closure is
 * reported with its reason.
 */
export function closeInvalidOpenRides(world: World): void {
  const ride = world.rides.cols;
  for (let slot = 0; slot < world.rides.count; slot++) {
    if (ride.state[slot] !== RideState.Open) continue;
    const rideId = world.rides.slotToId[slot];
    let reason = RideResult.Ok;
    if (isTrackRide(world, rideId)) {
      if (!circuitStatus(world, rideId).complete) reason = RideResult.TrackIncomplete;
      else if (!ride.tested[slot]) reason = RideResult.NotTested;
    }
    const shop = isShopCategory(RIDE_CATALOG[ride.typeId[slot] as RideType]?.category ?? '');
    if (reason === RideResult.Ok && !shop && !ride.entrancePlaced[slot])
      reason = RideResult.NoEntrance;
    if (reason === RideResult.Ok) continue;
    ride.state[slot] = RideState.Closed;
    abortCycle(world, slot);
    removeRideTrains(world, rideId);
    reportFeedback(world.feedback, FeedbackDomain.Ride, reason, rideId);
  }
}

function closeRide(world: World, rideId: number): RideResult {
  if (!world.rides.isAlive(rideId)) return RideResult.NoSuchRide;
  const slot = world.rides.idToSlot[rideId];
  if (world.rides.cols.state[slot] === RideState.Testing) {
    abortRideTest(world, rideId);
    return RideResult.Ok;
  }
  if (world.rides.cols.state[slot] === RideState.Broken) return RideResult.Broken;
  return setRideOpen(world, rideId, false) ? RideResult.Ok : RideResult.NoSuchRide;
}

function startFlatRideTest(world: World, rideId: number): RideResult {
  if (!world.rides.isAlive(rideId)) return RideResult.NoSuchRide;
  const slot = world.rides.idToSlot[rideId];
  const ride = world.rides.cols;
  if (ride.state[slot] === RideState.Broken) return RideResult.Broken;
  if (isBusy(world, slot)) return RideResult.Busy;
  ride.tested[slot] = 0;
  ride.state[slot] = RideState.Testing;
  ride.phase[slot] = RidePhase.Running;
  ride.phaseTicks[slot] = ride.runTicks[slot];
  return RideResult.Ok;
}

function demolishRide(world: World, rideId: number): RideResult {
  if (!world.rides.isAlive(rideId)) return RideResult.NoSuchRide;
  const slot = world.rides.idToSlot[rideId];
  const ride = world.rides.cols;
  const refund = demolitionRefund(world, rideId);
  const disembarkTile = findDisembarkTile(world, slot);

  if (ride.state[slot] === RideState.Testing) abortRideTest(world, rideId);
  removeRideTrains(world, rideId);
  for (let guest = 0; guest < world.guests.count; guest++) {
    if (world.guests.cols.targetRide[guest] !== rideId) continue;
    const access = disembarkTile ?? [ride.rideX[slot], ride.rideY[slot]];
    const guests = world.guests.cols;
    guests.x[guest] = access[0]! * TILE_UNITS + (TILE_UNITS >> 1);
    guests.y[guest] = access[1]! * TILE_UNITS + (TILE_UNITS >> 1);
    guests.z[guest] = world.map.heightAt(guests.x[guest], guests.y[guest]);
    guests.heading[guest] = HEADING_NONE;
    guests.targetRide[guest] = -1;
    guests.targetX[guest] = access[0]!;
    guests.targetY[guest] = access[1]!;
    guests.navGoal[guest] = 0;
    guests.navGap[guest] = 0;
    guests.navSteps[guest] = 0;
    guests.state[guest] = GuestState.Wandering;
  }
  earn(world, LedgerCategory.RideConstruction, refund);
  world.rides.despawnId(rideId);
  return RideResult.Ok;
}

export function applyRideCommand(world: World, c: RideCommand): RideResult {
  let result: RideResult;
  switch (c.type) {
    case 'placeRideEntrance':
      result = placeBoardingTile(world, c.rideId, c.x, c.y, 'entrance');
      break;
    case 'placeRideExit':
      result = placeBoardingTile(world, c.rideId, c.x, c.y, 'exit');
      break;
    case 'setRideStatus':
      result =
        c.status === 'open'
          ? openRide(world, c.rideId)
          : c.status === 'close'
            ? closeRide(world, c.rideId)
            : isTrackRide(world, c.rideId)
              ? startRideTest(world, c.rideId)
              : startFlatRideTest(world, c.rideId);
      break;
    case 'setRidePrice':
      result = setRidePrice(world, c.rideId, c.priceCents, c.item ?? 0)
        ? RideResult.Ok
        : RideResult.Blocked;
      break;
    case 'setRideQueueLimit':
      result = setRideQueueLimit(world, c.rideId, c.limit) ? RideResult.Ok : RideResult.Blocked;
      break;
    case 'setRideTrains':
      result = setTrainLayout(world, c.rideId, c.trains, c.cars);
      break;
    case 'setRideMode':
      result = !world.rides.isAlive(c.rideId)
        ? RideResult.NoSuchRide
        : setRideMode(world, c.rideId, c.mode)
          ? RideResult.Ok
          : RideResult.Busy;
      break;
    case 'setRideInspection':
      result = !world.rides.isAlive(c.rideId)
        ? RideResult.NoSuchRide
        : setRideInspectionInterval(world, c.rideId, c.minutes)
          ? RideResult.Ok
          : RideResult.Blocked;
      break;
    case 'setObservationTowerHeight':
      result = setObservationTowerHeight(world, c.rideId, c.height);
      break;
    case 'demolishRide':
      result = demolishRide(world, c.rideId);
      break;
  }
  const detail = result === RideResult.HeightLimit ? heightCapDetail(world) : '';
  reportFeedback(world.feedback, FeedbackDomain.Ride, result, c.rideId, detail);
  return result;
}
