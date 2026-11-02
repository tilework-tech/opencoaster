import type { World } from '../core/world';
import { exceedsHeightCap, heightCapDetail } from '../scenario/restrictions';
import type { Command } from '../core/commands';
import { TRACK_Z_STEP, Z_STEP } from '../core/constants';
import { FeedbackDomain, reportFeedback } from '../core/feedback';
import { charge } from '../economy/api';
import { LedgerCategory } from '../economy/ledger';
import { ElementType, Surface } from '../map/tile-map';
import { rideCoversTile } from '../rides/ride-footprint';
import { badTunnelEntry, undergroundTiles } from './clearance';
import { invalidateRideTest, isTrackRide, loadedTrips } from '../rides/coaster';
import { detachStrandedGates } from '../rides/ride-boarding';
import { isBusy } from '../rides/ride-commands';
import { enableBlockSections } from '../rides/ride-operations';
import { RIDE_CATALOG } from '../rides/ride-types';
import type { RideType } from '../rides/ride-types';
import { PIECES } from './catalog';
import {
  attachPoint,
  placeTrack,
  removeTrack,
  rotateTile,
  validatePlacement,
} from './construction';
import type { PlaceRequest } from './construction';
import { MAX_TRACK_RIDES } from './track-store';
import { PieceFlag, PieceMode, Slope, TrackNotice, TrackResult, TrackWarning } from './track-types';
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
  if (req.z * TRACK_Z_STEP + top > rules.maxLevel * Z_STEP) return TrackResult.TooHigh;
  return TrackResult.Ok;
}

/** Whether the piece's structure rises above the scenario's height cap on any tile it covers. */
function trackAboveCap(world: World, req: PlaceRequest): boolean {
  const base = req.z * TRACK_Z_STEP;
  return PIECES[req.pieceType].footprint.some((cell) => {
    const [rx, ry] = rotateTile(cell.i, cell.j, req.dir);
    return exceedsHeightCap(world, world.map.index(req.x + rx, req.y + ry), base + cell.zMax);
  });
}

function ownsFootprint(world: World, req: PlaceRequest): boolean {
  const map = world.map;
  for (const cell of PIECES[req.pieceType].footprint) {
    const [rx, ry] = rotateTile(cell.i, cell.j, req.dir);
    if (!map.canBuild(map.index(req.x + rx, req.y + ry))) return false;
  }
  return true;
}

/** True when a below-ground section of the piece would run under a ride, a footpath or water. */
function tunnelBlocked(world: World, req: PlaceRequest): boolean {
  const map = world.map;
  for (const tile of undergroundTiles(map, req.pieceType, req.x, req.y, req.z, req.dir)) {
    if (map.waterLevel[tile] > map.heights[tile]) return true;
    for (let e = map.firstElement(tile); e >= 0; e = map.nextElement(e))
      if (map.elType[e] === ElementType.Path) return true;
    const x = tile % map.width;
    const y = (tile / map.width) | 0;
    for (let slot = 0; slot < world.rides.count; slot++)
      if (rideCoversTile(world, slot, x, y)) return true;
  }
  return false;
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
  if (trackAboveCap(world, req)) return TrackResult.HeightLimit;
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
  if (tunnelBlocked(world, req)) return TrackResult.TunnelBlocked;
  if (badTunnelEntry(world.map, req.pieceType, req.x, req.y, req.z, req.dir))
    return TrackResult.TunnelEntry;
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
  if (!(PIECES[c.pieceType].flags & PieceFlag.Inverted)) return null;
  const attach = attachPoint(world, { ...c, dir: c.dir as Direction, mode: c.mode as PieceMode });
  if (typeof attach === 'number' || attach.after < 0) return null;
  const previous = t.pieces.idToSlot[attach.after];
  return t.pieces.cols.mode[previous] === PieceMode.ChainLift
    ? TrackWarning.LiftIntoInversion
    : null;
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
    if (result === TrackResult.HeightLimit) world.track.lastBlockerName = heightCapDetail(world);
    world.track.lastResult = result;
    world.track.lastPiece = -1;
    return result;
  }
  placeTrack(world, req);
  charge(world, LedgerCategory.RideConstruction, PIECES[req.pieceType].cost);
  invalidateRideTest(world, req.rideId);
  if (req.mode === PieceMode.BlockBrake) enableBlockSections(world, req.rideId);
  return TrackResult.Ok;
}

/**
 * Track can only change under a ride that is closed with its trains home and empty: not while it
 * is open or testing, while a train is out, or while riders are aboard.
 */
function rideInUse(world: World, rideId: number): boolean {
  if (!isTrackRide(world, rideId)) return false;
  return isBusy(world, world.rides.idToSlot[rideId]) || loadedTrips(world, rideId) > 0;
}

/** Applies a track command; the outcome is recorded in `world.track.lastResult` and feedback. */
export function applyTrackCommand(world: World, c: TrackCommand): TrackResult {
  let result: TrackResult;
  let code: number;
  if (rideInUse(world, c.rideId)) {
    world.track.lastResult = TrackResult.RideBusy;
    world.track.lastPiece = -1;
    result = code = TrackResult.RideBusy;
  } else if (c.type === 'placeTrack') {
    const warning = placementWarning(world, c);
    result = applyPlace(world, c);
    code = result === TrackResult.Ok && warning !== null ? warning : result;
  } else {
    result = removeTrack(world, c.rideId, c.pieceId);
    if (result === TrackResult.Ok) {
      invalidateRideTest(world, c.rideId);
      detachStrandedGates(world, world.rides.idToSlot[c.rideId]);
    }
    code = result === TrackResult.Ok ? TrackNotice.Removed : result;
  }
  reportFeedback(world.feedback, FeedbackDomain.Track, code, c.rideId, world.track.lastBlockerName);
  return result;
}
