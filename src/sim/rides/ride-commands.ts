import type { World } from '../core/world';
import { Z_STEP } from '../core/constants';
import { FeedbackDomain, reportFeedback } from '../core/feedback';
import { charge } from '../economy/api';
import { LedgerCategory } from '../economy/ledger';
import { PATH_COST_CENTS, Surface } from '../map/tile-map';
import { placePath } from '../map/paths';
import { PIECES } from '../track/catalog';
import { rotateTile } from '../track/construction';
import { PieceFlag } from '../track/track-types';
import { abortRideTest, isTrackRide, startRideTest } from './coaster';
import { setRideOpen } from './ride-operations';
import { RIDE_CATALOG } from './ride-types';
import type { RideType } from './ride-types';
import { RidePhase, RideState } from './ride-store';
import { RideResult } from './ride-results';

export type RideCommand =
  | { type: 'placeRideEntrance'; rideId: number; x: number; y: number }
  | { type: 'placeRideExit'; rideId: number; x: number; y: number }
  | { type: 'setRideStatus'; rideId: number; status: 'open' | 'close' | 'test' };

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
  const exit = map.index(ride.exitX[slot], ride.exitY[slot]);
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
  const otherPlaced = kind === 'entrance' ? ride.exitPlaced[slot] : ride.entrancePlaced[slot];
  const otherX = kind === 'entrance' ? ride.exitX[slot] : ride.entranceX[slot];
  const otherY = kind === 'entrance' ? ride.exitY[slot] : ride.entranceY[slot];
  if (otherPlaced && otherX === x && otherY === y) return RideResult.Blocked;
  const tile = world.map.index(x, y);
  if (!world.map.canBuild(tile)) return RideResult.NotOwned;
  if (trackAtGround(world, x, y)) return RideResult.Blocked;

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
  if (ride.state[slot] === RideState.Broken) return RideResult.Broken;
  if (isBusy(world, slot)) return RideResult.Busy;
  const tracked = isTrackRide(world, rideId);
  if (tracked && !ride.tested[slot]) return RideResult.NotTested;
  if (!ride.entrancePlaced[slot]) return RideResult.NoEntrance;
  if (!ride.exitPlaced[slot]) return RideResult.NoExit;
  if (tracked) connectQueueFromEntrance(world, slot);
  if (!ride.queueConnected[slot]) return RideResult.NoQueue;
  return setRideOpen(world, rideId, true) ? RideResult.Ok : RideResult.Busy;
}

function closeRide(world: World, rideId: number): RideResult {
  if (!world.rides.isAlive(rideId)) return RideResult.NoSuchRide;
  if (world.rides.cols.state[world.rides.idToSlot[rideId]] === RideState.Testing) {
    abortRideTest(world, rideId);
    return RideResult.Ok;
  }
  return setRideOpen(world, rideId, false) ? RideResult.Ok : RideResult.NoSuchRide;
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
            : startRideTest(world, c.rideId);
      break;
  }
  reportFeedback(world.feedback, FeedbackDomain.Ride, result, c.rideId);
  return result;
}
