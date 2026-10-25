import type { World } from '../core/world';
import { TILE_UNITS, Z_STEP } from '../core/constants';
import { FeedbackDomain, reportFeedback } from '../core/feedback';
import { charge, earn } from '../economy/api';
import { LedgerCategory } from '../economy/ledger';
import { PATH_COST_CENTS, Surface } from '../map/tile-map';
import { placePath } from '../map/paths';
import { PIECES } from '../track/catalog';
import { rotateTile } from '../track/construction';
import { PieceFlag } from '../track/track-types';
import { abortRideTest, isTrackRide, startRideTest } from './coaster';
import { GuestState, HEADING_NONE } from '../guests/guest-store';
import { removeRideTrains } from '../vehicles/ride-trains';
import {
  setRideInspectionInterval,
  setRideMode,
  setRideOpen,
  setRidePrice,
  setTrainLayout,
} from './ride-operations';
import type { RideMode } from './ride-modes';
import { RIDE_CATALOG } from './ride-types';
import type { RideType } from './ride-types';
import { RidePhase, RideState } from './ride-store';
import { RideResult } from './ride-results';
import { demolitionRefund } from './ride-refund';

export type RideCommand =
  | { type: 'placeRideEntrance'; rideId: number; x: number; y: number }
  | { type: 'placeRideExit'; rideId: number; x: number; y: number }
  | { type: 'setRideStatus'; rideId: number; status: 'open' | 'close' | 'test' }
  | { type: 'setRidePrice'; rideId: number; priceCents: number }
  | { type: 'setRideTrains'; rideId: number; trains: number; cars: number }
  | { type: 'setRideMode'; rideId: number; mode: RideMode }
  /** `minutes` is one of `INSPECTION_INTERVAL_MINUTES`, or 0 for never. */
  | { type: 'setRideInspection'; rideId: number; minutes: number }
  | { type: 'demolishRide'; rideId: number };

/** Tiles the ride's guests board and leave from: station tiles for track rides. */
function boardingTiles(world: World, rideId: number, slot: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const ride = world.rides.cols;
  const def = RIDE_CATALOG[ride.typeId[slot] as RideType];
  if (!def.usesTrack) {
    for (const [dx, dy] of def.footprint) out.push([ride.rideX[slot] + dx, ride.rideY[slot] + dy]);
    return out;
  }
  const pieces = world.track.pieces;
  for (let s = 0; s < pieces.count; s++) {
    if (pieces.cols.rideId[s] !== rideId) continue;
    const piece = PIECES[pieces.cols.pieceType[s]];
    if (!(piece.flags & PieceFlag.Station)) continue;
    for (const cell of piece.footprint) {
      const [rx, ry] = rotateTile(cell.i, cell.j, pieces.cols.dir[s]);
      out.push([pieces.cols.x[s] + rx, pieces.cols.y[s] + ry]);
    }
  }
  return out;
}

/** True when any track piece passes through the tile close to the ground. */
function trackAtGround(world: World, x: number, y: number): boolean {
  const pieces = world.track.pieces;
  const groundZ = world.map.heights[world.map.index(x, y)] * Z_STEP;
  for (let s = 0; s < pieces.count; s++) {
    const piece = PIECES[pieces.cols.pieceType[s]];
    for (const cell of piece.footprint) {
      const [rx, ry] = rotateTile(cell.i, cell.j, pieces.cols.dir[s]);
      if (pieces.cols.x[s] + rx !== x || pieces.cols.y[s] + ry !== y) continue;
      if (pieces.cols.z[s] * Z_STEP + cell.zMin <= groundZ + 2 * Z_STEP) return true;
    }
  }
  return false;
}

function rideFootprintAt(world: World, x: number, y: number): boolean {
  const ride = world.rides.cols;
  for (let slot = 0; slot < world.rides.count; slot++) {
    const def = RIDE_CATALOG[ride.typeId[slot] as RideType];
    for (const [dx, dy] of def?.footprint ?? []) {
      if (ride.rideX[slot] + dx === x && ride.rideY[slot] + dy === y) return true;
    }
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
 * Walks the queue tiles from the entrance. The queue is connected when a plain path tile
 * touches it; its capacity grows with the number of queue tiles.
 */
function connectQueueFromEntrance(world: World, slot: number): void {
  const map = world.map;
  const ride = world.rides.cols;
  const exit = ride.exitPlaced[slot] ? map.index(ride.exitX[slot], ride.exitY[slot]) : -1;
  const start = map.index(ride.entranceX[slot], ride.entranceY[slot]);
  const seen = new Set<number>([start]);
  const stack = [start];
  let queueTiles = 0;
  let reachesPath = false;
  while (stack.length > 0 && queueTiles < 64) {
    const tile = stack.pop() as number;
    queueTiles++;
    for (let dir = 0; dir < 4; dir++) {
      const next = map.neighbor(tile, dir);
      if (next < 0 || next === exit || seen.has(next)) continue;
      if (map.surface[next] === Surface.Queue) {
        seen.add(next);
        stack.push(next);
      } else if (map.surface[next] === Surface.Path) {
        reachesPath = true;
      }
    }
  }
  ride.queueLineTiles[slot] = queueTiles;
  ride.queueConnected[slot] = reachesPath ? 1 : 0;
}

export function refreshRideQueueConnections(world: World): void {
  for (let slot = 0; slot < world.rides.count; slot++) {
    const ride = world.rides.cols;
    const def = RIDE_CATALOG[ride.typeId[slot] as RideType];
    if (def?.category === 'stall' || def?.category === 'facility') {
      const access = findAdjacentPath(world, slot, def.footprint);
      if (access) {
        ride.entranceX[slot] = access[0];
        ride.entranceY[slot] = access[1];
        ride.entrancePlaced[slot] = 1;
      } else if (ride.entrancePlaced[slot]) {
        ride.entrancePlaced[slot] = 0;
        if (ride.state[slot] === RideState.Open)
          setRideOpen(world, world.rides.slotToId[slot], false);
      }
    } else if (ride.entrancePlaced[slot]) {
      connectQueueFromEntrance(world, slot);
    }
  }
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

function findAdjacentPath(
  world: World,
  slot: number,
  footprint: readonly (readonly [number, number])[],
): [number, number] | null {
  const ride = world.rides.cols;
  for (const [dx, dy] of footprint) {
    const x = ride.rideX[slot] + dx;
    const y = ride.rideY[slot] + dy;
    for (const [ox, oy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      const px = x + ox;
      const py = y + oy;
      if (world.map.inBounds(px, py) && world.map.surface[world.map.index(px, py)] === Surface.Path)
        return [px, py];
    }
  }
  return null;
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
  if (isBusy(world, slot)) return RideResult.Busy;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !world.map.inBounds(x, y)) {
    return RideResult.OutOfBounds;
  }
  const adjacent = boardingTiles(world, rideId, slot).some(
    ([bx, by]) => Math.abs(bx - x) + Math.abs(by - y) === 1,
  );
  if (!adjacent) return RideResult.NotAdjacentToStation;
  const ride = world.rides.cols;
  const def = RIDE_CATALOG[ride.typeId[slot] as RideType];
  const directAccess = def.category === 'stall' || def.category === 'facility';
  const tile = world.map.index(x, y);
  if (directAccess) {
    if (
      kind !== 'entrance' ||
      world.map.surface[tile] !== Surface.Path ||
      !world.map.canBuild(tile) ||
      trackAtGround(world, x, y)
    )
      return RideResult.Blocked;
    ride.entranceX[slot] = x;
    ride.entranceY[slot] = y;
    ride.entrancePlaced[slot] = 1;
    return RideResult.Ok;
  }
  const otherPlaced = kind === 'entrance' ? ride.exitPlaced[slot] : ride.entrancePlaced[slot];
  const otherX = kind === 'entrance' ? ride.exitX[slot] : ride.entranceX[slot];
  const otherY = kind === 'entrance' ? ride.exitY[slot] : ride.entranceY[slot];
  if (otherPlaced && otherX === x && otherY === y) return RideResult.Blocked;
  if (!world.map.canBuild(tile)) return RideResult.NotOwned;
  if (trackAtGround(world, x, y) || rideFootprintAt(world, x, y)) return RideResult.Blocked;

  const wanted = kind === 'entrance' ? Surface.Queue : Surface.Path;
  const surface = world.map.surface[tile];
  const alreadyRight =
    kind === 'entrance'
      ? surface === Surface.Queue
      : surface === Surface.Path || surface === Surface.Queue;
  if (!alreadyRight) {
    if (world.economy.cash < PATH_COST_CENTS) return RideResult.InsufficientFunds;
    if (!placePath(world.map, { x, y, queue: wanted === Surface.Queue })) return RideResult.Blocked;
    charge(world, LedgerCategory.Landscaping, PATH_COST_CENTS);
  }
  if (kind === 'entrance') {
    ride.entranceX[slot] = x;
    ride.entranceY[slot] = y;
    ride.entrancePlaced[slot] = 1;
    connectQueueFromEntrance(world, slot);
  } else {
    ride.exitX[slot] = x;
    ride.exitY[slot] = y;
    ride.exitPlaced[slot] = 1;
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
  if (tracked && !ride.tested[slot]) return RideResult.NotTested;
  if (!ride.entrancePlaced[slot]) return RideResult.NoEntrance;
  if (def.category !== 'stall' && def.category !== 'facility' && !ride.exitPlaced[slot])
    return RideResult.NoExit;
  if (def.category !== 'stall' && def.category !== 'facility') {
    connectQueueFromEntrance(world, slot);
    if (!ride.queueConnected[slot]) return RideResult.NoQueue;
  }
  return setRideOpen(world, rideId, true) ? RideResult.Ok : RideResult.Busy;
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
      result = setRidePrice(world, c.rideId, c.priceCents) ? RideResult.Ok : RideResult.Blocked;
      break;
    case 'setRideTrains':
      result = setTrainLayout(world, c.rideId, c.trains, c.cars)
        ? RideResult.Ok
        : RideResult.Blocked;
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
    case 'demolishRide':
      result = demolishRide(world, c.rideId);
      break;
  }
  reportFeedback(world.feedback, FeedbackDomain.Ride, result, c.rideId);
  return result;
}
