import { FeedbackDomain } from '../sim/core/feedback';
import { RideResult } from '../sim/rides/ride-results';
import { RIDE_CATALOG } from '../sim/rides/ride-types';
import type { RideType } from '../sim/rides/ride-types';
import { PIECES } from '../sim/track/catalog';
import { rotateTile } from '../sim/track/construction';
import { Bank, PieceFlag, PieceMode, Slope, TrackResult } from '../sim/track/track-types';
import type { TrackPieceDef } from '../sim/track/track-types';

export type TurnKind =
  | 'station'
  | 'straight'
  | 'smallLeft'
  | 'smallRight'
  | 'mediumLeft'
  | 'mediumRight'
  | 'largeLeft'
  | 'largeRight'
  | 'loopLeft'
  | 'loopRight';

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

const CURVE_SIZES = ['', '', 'small', 'medium', 'large'] as const;

/** The horizontal shape a catalog piece has, in the vocabulary of the build controls. */
export function classifyPiece(piece: TrackPieceDef): TurnKind {
  if (piece.flags & PieceFlag.Station) return 'station';
  if (piece.flags & PieceFlag.Inverted) return piece.dy < 0 ? 'loopLeft' : 'loopRight';
  if (piece.headingDelta === 0) return 'straight';
  const size = CURVE_SIZES[Math.abs(piece.dy)];
  return `${size}${piece.headingDelta === 1 ? 'Right' : 'Left'}` as TurnKind;
}

const PIECE_TURNS: readonly TurnKind[] = PIECES.map(classifyPiece);

/** The piece that matches the controls and attaches to the cursor, if the catalog has one. */
export function resolvePiece(cursor: CursorShape, choice: PieceChoice): TrackPieceDef | undefined {
  return PIECES.find(
    (piece, index) =>
      PIECE_TURNS[index] === choice.turn &&
      piece.exitSlope === choice.slope &&
      piece.exitBank === choice.bank &&
      (!cursor.hasTrack || (piece.entrySlope === cursor.slope && piece.entryBank === cursor.bank)),
  );
}

/** Drive modes the piece supports on this ride type, in display order. */
export function allowedModes(piece: TrackPieceDef, rideType: RideType): PieceMode[] {
  const rules = RIDE_CATALOG[rideType]?.trackRules;
  const modes = [PieceMode.Normal];
  if (piece.flags & PieceFlag.LiftOk) modes.push(PieceMode.ChainLift);
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
  ['smallLeft', 'Left small'],
  ['mediumLeft', 'Left medium'],
  ['largeLeft', 'Left large'],
  ['smallRight', 'Right small'],
  ['mediumRight', 'Right medium'],
  ['largeRight', 'Right large'],
  ['loopLeft', 'Loop left'],
  ['loopRight', 'Loop right'],
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
): TrackResult {
  for (const [x, y] of footprintTiles(piece, placement.x, placement.y, placement.dir)) {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return TrackResult.OutOfBounds;
    if (!buildable?.[y * map.width + x]) return TrackResult.NotOwned;
  }
  if (cash < piece.cost) return TrackResult.InsufficientFunds;
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
  [TrackResult.NotConnected]: 'The piece does not connect to the end of the track.',
  [TrackResult.Blocked]: 'Blocked by other track.',
  [TrackResult.BelowGround]: 'The piece would go below the ground.',
  [TrackResult.TooHigh]: 'The piece is too high for this ride.',
  [TrackResult.BadMode]: 'This piece cannot use that drive mode.',
  [TrackResult.TooManyPieces]: 'This ride has too many track pieces.',
  [TrackResult.CircuitClosed]: 'The circuit is complete; remove a piece to extend it.',
  [TrackResult.NotAtEnd]: 'Only the end of an unfinished track can be removed.',
  [TrackResult.StoreFull]: 'The park cannot hold any more track.',
  [TrackResult.NotOwned]: 'You need to own the land or its construction rights.',
  [TrackResult.InsufficientFunds]: 'Not enough cash for that piece.',
  [TrackResult.PieceNotAllowed]: 'This ride type cannot use that piece or mode.',
};

const RIDE_MESSAGES: Record<RideResult, string> = {
  [RideResult.Ok]: 'Done.',
  [RideResult.NoSuchRide]: 'That ride no longer exists.',
  [RideResult.NotTrackRide]: 'This ride does not use track.',
  [RideResult.TrackIncomplete]: 'Build a closed circuit that includes a station first.',
  [RideResult.Busy]: 'The ride is running; close it and wait for the train to return.',
  [RideResult.Broken]: 'The ride is broken down and needs a mechanic.',
  [RideResult.NotTested]: 'Run a test before opening the ride.',
  [RideResult.NoEntrance]: 'Place an entrance next to the station.',
  [RideResult.NoExit]: 'Place an exit next to the station.',
  [RideResult.NoQueue]: 'Connect a footpath to the entrance queue.',
  [RideResult.NotAdjacentToStation]: 'Entrance and exit must touch the station.',
  [RideResult.NotOwned]: 'You need to own that land or its construction rights.',
  [RideResult.Blocked]: 'Something is in the way.',
  [RideResult.InsufficientFunds]: 'Not enough cash.',
  [RideResult.OutOfBounds]: 'That is outside the map.',
  [RideResult.TestFailed]: 'Test failed: the train stalled, crashed or never finished the lap.',
  [RideResult.TestPassed]: 'Test complete: ratings updated.',
};

/** Player-facing text for a command outcome from the simulation. */
export function feedbackMessage(domain: FeedbackDomain, code: number): FeedbackLine {
  const ok = code === 0 || code === RideResult.TestPassed;
  if (domain === FeedbackDomain.Track) {
    return { text: TRACK_MESSAGES[code as TrackResult] ?? `Track result ${code}`, ok: code === 0 };
  }
  if (domain === FeedbackDomain.Ride) {
    return { text: RIDE_MESSAGES[code as RideResult] ?? `Ride result ${code}`, ok };
  }
  return { text: '', ok: true };
}
