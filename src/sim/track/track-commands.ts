import type { World } from '../core/world';
import type { Command } from '../core/commands';
import { Z_STEP } from '../core/constants';
import { FeedbackDomain, reportFeedback } from '../core/feedback';
import { charge } from '../economy/api';
import { LedgerCategory } from '../economy/ledger';
import { Surface } from '../map/tile-map';
import { invalidateRideTest } from '../rides/coaster';
import { RIDE_CATALOG } from '../rides/ride-types';
import type { RideType } from '../rides/ride-types';
import { PIECES } from './catalog';
import { placeTrack, removeTrack, rotateTile, validatePlacement } from './construction';
import type { PlaceRequest } from './construction';
import { MAX_TRACK_RIDES } from './track-store';
import { PieceFlag, PieceMode, Slope, TrackResult, TrackWarning } from './track-types';
import type { Direction } from './track-types';

export type TrackCommand = Extract<Command, { type: 'placeTrack' | 'removeTrack' }>;

/** Limits imposed by the ride type (see `RideTypeDef.trackRules`). */
function checkRideRules(world: World, req: PlaceRequest): TrackResult {
  const def = PIECES[req.pieceType];
  if (!def || req.rideId < 0 || req.rideId >= MAX_TRACK_RIDES || !world.rides.isAlive(req.rideId)) {
    return TrackResult.Ok;
  }
  const rules =
    RIDE_CATALOG[world.rides.cols.typeId[world.rides.idToSlot[req.rideId]] as RideType]?.trackRules;
  if (!rules) return TrackResult.Ok;
  if (rules.allowedPieces && !rules.allowedPieces.includes(req.pieceType)) {
    return TrackResult.PieceNotAllowed;
  }
  const steep =
    Math.abs(def.entrySlope) === Math.abs(Slope.Up60) ||
    Math.abs(def.exitSlope) === Math.abs(Slope.Up60);
  if (steep && !rules.steepSlopes) return TrackResult.PieceNotAllowed;
  if (def.flags & PieceFlag.Inverted && !rules.inversions) return TrackResult.PieceNotAllowed;
  if (req.mode === PieceMode.Launch && !rules.launch) return TrackResult.PieceNotAllowed;
  const waterRide =
    RIDE_CATALOG[world.rides.cols.typeId[world.rides.idToSlot[req.rideId]] as RideType]
      ?.category === 'water';
  if (
    req.mode === PieceMode.WaterLift &&
    (!waterRide || (def.entrySlope <= 0 && def.exitSlope <= 0))
  )
    return TrackResult.BadMode;
  if (req.mode === PieceMode.ChainLift && waterRide) return TrackResult.BadMode;
  let top = 0;
  for (const cell of def.footprint) top = Math.max(top, cell.zMax);
  if (req.z * Z_STEP + top > rules.maxLevel * Z_STEP) return TrackResult.TooHigh;
  return TrackResult.Ok;
}

function ownsFootprint(world: World, req: PlaceRequest): boolean {
  const map = world.map;
  for (const cell of PIECES[req.pieceType].footprint) {
    const [rx, ry] = rotateTile(cell.i, cell.j, req.dir);
    if (!map.canBuild(map.index(req.x + rx, req.y + ry))) return false;
  }
  return true;
}

/**
 * Everything that decides whether a placement command succeeds: ride-type rules, geometry,
 * ownership of every tile the piece covers, and the park's cash.
 */
export function validatePlaceCommand(world: World, req: PlaceRequest): TrackResult {
  const rules = checkRideRules(world, req);
  if (rules !== TrackResult.Ok) return rules;
  const geometry = validatePlacement(world, req);
  if (geometry !== TrackResult.Ok) return geometry;
  const rideSlot = world.rides.idToSlot[req.rideId];
  const rideType = world.rides.cols.typeId[rideSlot] as RideType;
  if (!RIDE_CATALOG[rideType]?.allowsWater) {
    for (const cell of PIECES[req.pieceType].footprint) {
      const [rx, ry] = rotateTile(cell.i, cell.j, req.dir);
      const tile = world.map.index(req.x + rx, req.y + ry);
      if (
        world.map.surface[tile] === Surface.Water &&
        world.map.waterLevel[tile] > world.map.heights[tile]
      )
        return TrackResult.OverWater;
    }
  }
  if (!ownsFootprint(world, req)) return TrackResult.NotOwned;
  if (world.economy.cash < PIECES[req.pieceType].cost) return TrackResult.InsufficientFunds;
  return TrackResult.Ok;
}

/** The warning for a piece that would follow a chain lift's last piece onto an inversion. */
function placementWarning(
  world: World,
  c: Extract<TrackCommand, { type: 'placeTrack' }>,
): TrackWarning | null {
  const t = world.track;
  const tail = t.tail[c.rideId];
  if (tail < 0 || !(PIECES[c.pieceType].flags & PieceFlag.Inverted)) return null;
  const cols = t.pieces.cols;
  const previous = t.pieces.idToSlot[tail];
  return cols.mode[previous] === PieceMode.ChainLift ? TrackWarning.LiftIntoInversion : null;
}

function applyPlace(world: World, c: Extract<TrackCommand, { type: 'placeTrack' }>): TrackResult {
  const req: PlaceRequest = {
    rideId: c.rideId,
    pieceType: c.pieceType,
    x: c.x,
    y: c.y,
    z: c.z,
    dir: c.dir as Direction,
    mode: c.mode as PieceMode,
  };
  const result = validatePlaceCommand(world, req);
  if (result !== TrackResult.Ok) {
    world.track.lastResult = result;
    world.track.lastPiece = -1;
    return result;
  }
  placeTrack(world, req);
  charge(world, LedgerCategory.RideConstruction, PIECES[req.pieceType].cost);
  invalidateRideTest(world, req.rideId);
  return TrackResult.Ok;
}

/** Applies a track command; the outcome is recorded in `world.track.lastResult` and feedback. */
export function applyTrackCommand(world: World, c: TrackCommand): TrackResult {
  let result: TrackResult;
  let code: number;
  if (c.type === 'placeTrack') {
    const warning = placementWarning(world, c);
    result = applyPlace(world, c);
    code = result === TrackResult.Ok && warning !== null ? warning : result;
  } else {
    result = removeTrack(world, c.rideId, c.pieceId);
    if (result === TrackResult.Ok) invalidateRideTest(world, c.rideId);
    code = result;
  }
  reportFeedback(world.feedback, FeedbackDomain.Track, code, c.rideId);
  return result;
}
