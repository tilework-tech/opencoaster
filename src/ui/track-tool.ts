import { TRACK_STEPS_PER_LEVEL } from '../sim/core/constants';
import {
  aboveHeightCap,
  heightLimitRefusal,
  RESTRICTION_REFUSALS,
} from '../sim/scenario/restrictions';
import type { GroundLevels } from '../sim/scenario/restrictions';
import { FeedbackDomain } from '../sim/core/feedback';
import { RideResult } from '../sim/rides/ride-results';
import { RIDE_CATALOG } from '../sim/rides/ride-types';
import { RideType } from '../sim/rides/ride-types';
import { PIECES } from '../sim/track/catalog';
import { badTunnelEntry } from '../sim/track/clearance';
import type { TerrainTiles } from '../sim/track/clearance';
import { rotateTile } from '../sim/track/construction';
import {
  Bank,
  PieceFlag,
  PieceMode,
  Slope,
  TrackNotice,
  TrackResult,
  TrackWarning,
} from '../sim/track/track-types';
import type { PieceShape, TrackPieceDef } from '../sim/track/track-types';
import { occupancyConflict } from '../sim/map/occupancy';
import type { OccupancyVolume } from '../sim/map/occupancy';
import { Z_STEP } from '../sim/core/constants';
import { TRACK_CLEARANCE_WORLD } from '../sim/map/occupancy-constants';

export type TurnKind = PieceShape;

/** What the player has dialled in: horizontal shape, exit slope and exit bank. */
export interface PieceChoice {
  turn: TurnKind;
  slope: Slope;
  bank: Bank;
}

/** The part of the construction cursor a piece must connect to. */
export interface CursorShape {
  hasTrack: boolean;
  slope: Slope;
  bank: Bank;
}

export interface Placement {
  x: number;
  y: number;
  dir: number;
}

/** The horizontal shape a catalog piece has, in the vocabulary of the build controls. */
export function classifyPiece(piece: TrackPieceDef): TurnKind {
  return piece.shape;
}

const PIECE_TURNS: readonly TurnKind[] = PIECES.map(classifyPiece);

/** Whether the ride type's track rules let it use the piece. */
function rideTypeAllows(piece: TrackPieceDef, rideType?: RideType): boolean {
  const rules = rideType === undefined ? undefined : RIDE_CATALOG[rideType]?.trackRules;
  if (!rules) return true;
  if (rules.allowedPieces && !rules.allowedPieces.includes(piece.id)) return false;
  if (
    !rules.steepSlopes &&
    (Math.abs(piece.entrySlope) === Math.abs(Slope.Up60) ||
      Math.abs(piece.exitSlope) === Math.abs(Slope.Up60))
  )
    return false;
  return rules.inversions || !(piece.flags & PieceFlag.Inverted);
}

/** The piece that matches the controls and attaches to the cursor, if the catalog has one. */
export function resolvePiece(
  cursor: CursorShape,
  choice: PieceChoice,
  rideType?: RideType,
): TrackPieceDef | undefined {
  return PIECES.find(
    (piece, index) =>
      rideTypeAllows(piece, rideType) &&
      PIECE_TURNS[index] === choice.turn &&
      piece.exitSlope === choice.slope &&
      piece.exitBank === choice.bank &&
      (!cursor.hasTrack || (piece.entrySlope === cursor.slope && piece.entryBank === cursor.bank)),
  );
}

/**
 * The piece that matches the controls and leads into the start of a section whose first piece
 * begins with `start`'s slope and bank. Building backward, the slope and bank controls set the
 * new piece's far end: the slope and bank it starts with.
 */
export function resolvePieceBefore(
  start: CursorShape,
  choice: PieceChoice,
  rideType?: RideType,
): TrackPieceDef | undefined {
  return PIECES.find(
    (piece, index) =>
      rideTypeAllows(piece, rideType) &&
      PIECE_TURNS[index] === choice.turn &&
      piece.entrySlope === choice.slope &&
      piece.entryBank === choice.bank &&
      piece.exitSlope === start.slope &&
      piece.exitBank === start.bank,
  );
}

/** Drive modes the piece supports on this ride type, in display order. */
export function allowedModes(piece: TrackPieceDef, rideType: RideType): PieceMode[] {
  const rules = RIDE_CATALOG[rideType]?.trackRules;
  const modes = [PieceMode.Normal];
  const waterRide = rideType === RideType.LogFlume || rideType === RideType.RiverRapids;
  if (piece.flags & PieceFlag.LiftOk && (!waterRide || piece.entrySlope > 0 || piece.exitSlope > 0))
    modes.push(waterRide ? PieceMode.WaterLift : PieceMode.ChainLift);
  if (piece.flags & PieceFlag.BrakeOk) modes.push(PieceMode.Brake, PieceMode.BlockBrake);
  if (piece.flags & PieceFlag.LaunchOk && rules?.launch !== false) modes.push(PieceMode.Launch);
  return modes;
}

export const MODE_LABELS: Record<PieceMode, string> = {
  [PieceMode.Normal]: 'Normal',
  [PieceMode.ChainLift]: 'Chain lift',
  [PieceMode.Brake]: 'Brake',
  [PieceMode.BlockBrake]: 'Block brake',
  [PieceMode.Launch]: 'Launch',
  [PieceMode.WaterLift]: 'Powered climb',
};

export const SLOPE_LABELS: ReadonlyArray<readonly [Slope, string]> = [
  [Slope.Down60, 'Steep down'],
  [Slope.Down25, 'Down'],
  [Slope.Flat, 'Level'],
  [Slope.Up25, 'Up'],
  [Slope.Up60, 'Steep up'],
];

export const BANK_LABELS: ReadonlyArray<readonly [Bank, string]> = [
  [Bank.Left, 'Bank left'],
  [Bank.None, 'No bank'],
  [Bank.Right, 'Bank right'],
];

export const TURN_LABELS: ReadonlyArray<readonly [TurnKind, string]> = [
  ['station', 'Station'],
  ['straight', 'Straight'],
  ['waterSplashDrop', 'Water splash drop'],
  ['smallLeft', 'Left small'],
  ['mediumLeft', 'Left medium'],
  ['largeLeft', 'Left large'],
  ['smallRight', 'Right small'],
  ['mediumRight', 'Right medium'],
  ['largeRight', 'Right large'],
  ['loopLeft', 'Loop left'],
  ['loopRight', 'Loop right'],
  ['sBendLeft', 'S-bend left'],
  ['sBendRight', 'S-bend right'],
  ['corkscrewLeft', 'Corkscrew left'],
  ['corkscrewRight', 'Corkscrew right'],
  ['smallHelixLeftDown', 'Small helix left, down'],
  ['smallHelixLeftUp', 'Small helix left, up'],
  ['smallHelixRightDown', 'Small helix right, down'],
  ['smallHelixRightUp', 'Small helix right, up'],
  ['largeHelixLeftDown', 'Large helix left, down'],
  ['largeHelixLeftUp', 'Large helix left, up'],
  ['largeHelixRightDown', 'Large helix right, down'],
  ['largeHelixRightUp', 'Large helix right, up'],
];

/** Tiles a piece placed at `placement` covers. */
export function footprintTiles(
  piece: TrackPieceDef,
  x: number,
  y: number,
  dir: number,
): Array<[number, number]> {
  return piece.footprint.map((cell) => {
    const [rx, ry] = rotateTile(cell.i, cell.j, dir);
    return [x + rx, y + ry];
  });
}

/**
 * Cheap client-side check for hover feedback. The simulation re-checks everything (clearance,
 * ride-type rules, connection) when the command is applied and reports the authoritative result.
 */
export function previewStatus(
  map: { width: number; height: number },
  buildable: Uint8Array | undefined,
  piece: TrackPieceDef,
  placement: Placement,
  cash: number,
  level = 0,
  occupancies: readonly OccupancyVolume[] = [],
  rideType?: RideType,
  heightCap?: number,
): TrackResult {
  for (const [x, y] of footprintTiles(piece, placement.x, placement.y, placement.dir)) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return TrackResult.OutOfBounds;
    if (!buildable?.[y * map.width + x]) return TrackResult.NotOwned;
  }
  if (cash < piece.cost) return TrackResult.InsufficientFunds;
  if (heightCap !== undefined && 'heights' in map) {
    for (const cell of piece.footprint) {
      const [dx, dy] = rotateTile(cell.i, cell.j, placement.dir);
      const tile = (placement.y + dy) * map.width + placement.x + dx;
      const top = level * Z_STEP + cell.zMax;
      if (aboveHeightCap(heightCap, map as GroundLevels, tile, top)) return TrackResult.HeightLimit;
    }
  }
  const trackClearance =
    (rideType === undefined ? undefined : RIDE_CATALOG[rideType]?.trackClearanceWorld) ??
    TRACK_CLEARANCE_WORLD;
  for (const item of occupancies) {
    for (const cell of piece.footprint) {
      const [dx, dy] = rotateTile(cell.i, cell.j, placement.dir);
      if (
        occupancyConflict(
          {
            tileX: placement.x + dx,
            tileY: placement.y + dy,
            base: level * Z_STEP + cell.zMin,
            clearance: level * Z_STEP + cell.zMax + trackClearance,
            kind: piece.shape === 'station' ? 'station' : 'track',
            name: 'Track',
            levelCrossing: piece.shape === 'straight' && cell.zMin === 0,
          },
          item,
        )
      )
        return TrackResult.Blocked;
    }
  }
  if (
    'heights' in map &&
    badTunnelEntry(
      map as TerrainTiles,
      piece.id,
      placement.x,
      placement.y,
      Math.round(level * TRACK_STEPS_PER_LEVEL),
      placement.dir,
    )
  )
    return TrackResult.TunnelEntry;
  return TrackResult.Ok;
}

export interface FeedbackLine {
  text: string;
  ok: boolean;
}

const TRACK_MESSAGES: Record<TrackResult, string> = {
  [TrackResult.Ok]: 'Track piece placed.',
  [TrackResult.NoSuchRide]: 'That ride no longer exists.',
  [TrackResult.NoSuchPiece]: 'There is no track piece to remove there.',
  [TrackResult.OutOfBounds]: 'The piece would leave the map.',
  [TrackResult.NotConnected]: 'The piece does not connect to an open end of the track.',
  [TrackResult.Blocked]: 'Blocked by other track.',
  [TrackResult.BelowGround]: 'The piece would go below the ground.',
  [TrackResult.TooHigh]: 'The piece is too high for this ride.',
  [TrackResult.BadMode]: 'This piece cannot use that drive mode.',
  [TrackResult.TooManyPieces]: 'This ride has too many track pieces.',
  [TrackResult.CircuitClosed]: 'The circuit is complete; remove a piece to extend it.',
  [TrackResult.StoreFull]: 'The park cannot hold any more track.',
  [TrackResult.NotOwned]: 'You need to own the land or its construction rights.',
  [TrackResult.InsufficientFunds]: 'Not enough cash for that piece.',
  [TrackResult.PieceNotAllowed]: 'This ride type cannot use that piece or mode.',
  [TrackResult.TunnelBlocked]: 'Tunnels cannot run under rides, footpaths or water.',
  [TrackResult.TunnelEntry]:
    'Tunnels must enter through the side of the land, not a corner, and run straight until they are under cover.',
  [TrackResult.OverWater]: 'Track cannot be built over open water for this ride type.',
  [TrackResult.HeightLimit]: heightLimitRefusal(),
  [TrackResult.RideBusy]:
    'Close the ride and wait for its train to return empty before changing the track.',
};

const TRACK_WARNING_MESSAGES: Record<TrackWarning, string> = {
  [TrackWarning.LiftIntoInversion]:
    'Warning: an inversion straight after a chain lift can stall the train. Add speed before it.',
};

const RIDE_MESSAGES: Record<RideResult, string> = {
  [RideResult.Ok]: 'Done.',
  [RideResult.NoSuchRide]: 'That ride no longer exists.',
  [RideResult.NotTrackRide]: 'This ride does not use track.',
  [RideResult.TrackIncomplete]:
    'Circuit incomplete: build a closed circuit that includes a station first.',
  [RideResult.Busy]: 'The ride is running; close it and wait for the train to return.',
  [RideResult.Broken]: 'The ride is broken down and needs a mechanic.',
  [RideResult.NotTested]: 'Run a test before opening the ride.',
  [RideResult.NoEntrance]: 'Place an entrance next to the station.',
  [RideResult.NoExit]: 'Place an exit next to the station.',
  [RideResult.NoQueue]: 'Connect a footpath to the entrance queue.',
  [RideResult.NotAdjacentToStation]: 'Entrance and exit must touch the station.',
  [RideResult.ResearchRequired]: 'Research this ride type before building it.',
  [RideResult.NotOwned]: 'You need to own that land or its construction rights.',
  [RideResult.Blocked]: 'Something is in the way.',
  [RideResult.CutsPath]: 'That tile is part of a footpath; an entrance there would cut it in two.',
  [RideResult.InsufficientFunds]: 'Not enough cash.',
  [RideResult.OutOfBounds]: 'That is outside the map.',
  [RideResult.TestFailed]: 'Test failed: the train crashed or never finished the lap.',
  [RideResult.TestStalled]:
    'Test failed: the train stalled part way round. Give the lift more speed or move the inversion.',
  [RideResult.TestPassed]: 'Test complete: ratings updated.',
  [RideResult.TooSteep]: 'The ground under the ride is too uneven for its supports.',
  [RideResult.Underwater]: 'Part of the ride would be under water.',
  [RideResult.StallNoPath]:
    'No footpath in front of the service window. Build one on the highlighted tile, or rotate the stall (T).',
  [RideResult.StallQueue]:
    'The service window faces a queue line. Guests only buy from an ordinary footpath.',
  [RideResult.StallHeight]:
    'The footpath in front of the service window is not level with the stall floor.',
  [RideResult.StallSlope]:
    'The footpath ramp runs across the service window. A ramp must climb toward or away from the stall.',
  [RideResult.StallGate]:
    'The service window faces a ride exit. Guests only buy from an ordinary footpath.',
  [RideResult.HeightLimit]: heightLimitRefusal(),
  [RideResult.RideTypeForbidden]: RESTRICTION_REFUSALS.rideType,
};

/** Whether a command outcome means the edit did not happen (warnings and notices did happen). */
export function editRefused(domain: FeedbackDomain, code: number): boolean {
  if (domain === FeedbackDomain.Track)
    return (
      code !== TrackResult.Ok &&
      code !== TrackWarning.LiftIntoInversion &&
      code !== TrackNotice.Removed
    );
  return !feedbackMessage(domain, code).ok;
}

/** Player-facing text for a command outcome from the simulation. */
export function feedbackMessage(domain: FeedbackDomain, code: number, detail = ''): FeedbackLine {
  const ok = code === 0 || code === RideResult.TestPassed;
  if (domain === FeedbackDomain.Track) {
    if (code === TrackResult.Blocked && detail) return { text: `Blocked by ${detail}.`, ok: false };
    if (code === TrackResult.HeightLimit) return { text: heightLimitRefusal(detail), ok: false };
    if (code === TrackWarning.LiftIntoInversion) {
      return { text: TRACK_WARNING_MESSAGES[code], ok: false };
    }
    if (code === TrackNotice.Removed) return { text: 'Track piece removed.', ok: true };
    return { text: TRACK_MESSAGES[code as TrackResult] ?? `Track result ${code}`, ok: code === 0 };
  }
  if (domain === FeedbackDomain.Ride) {
    if (code === RideResult.HeightLimit) return { text: heightLimitRefusal(detail), ok: false };
    return { text: RIDE_MESSAGES[code as RideResult] ?? `Ride result ${code}`, ok };
  }
  return { text: '', ok: true };
}
