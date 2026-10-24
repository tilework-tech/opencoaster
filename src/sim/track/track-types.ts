/** Direction on the tile grid: 0=+x, 1=+y, 2=-x, 3=-y. A quarter turn "right" is +1. */
export type Direction = 0 | 1 | 2 | 3;

/** Pitch class at a piece boundary. Neighbouring pieces must agree on it. */
export const enum Slope {
  Down60 = -2,
  Down25 = -1,
  Flat = 0,
  Up25 = 1,
  Up60 = 2,
}

/** Roll class at a piece boundary. Left rolls the rider toward -bank, right toward +bank. */
export const enum Bank {
  None = 0,
  Left = 1,
  Right = 2,
}

/** Per-instance drive mode of a placed piece. */
export const enum PieceMode {
  Normal = 0,
  ChainLift = 1,
  Brake = 2,
  BlockBrake = 3,
  Launch = 4,
}

/** Static per-piece-type capability flags. */
export const enum PieceFlag {
  Station = 1 << 0,
  LiftOk = 1 << 1,
  BrakeOk = 1 << 2,
  TunnelOk = 1 << 3,
  Inverted = 1 << 4,
  Crest = 1 << 5,
  DropStart = 1 << 6,
  LaunchOk = 1 << 7,
}

/** Outcome of validating or applying a track edit. */
export const enum TrackResult {
  Ok = 0,
  NoSuchRide = 1,
  NoSuchPiece = 2,
  OutOfBounds = 3,
  NotConnected = 4,
  Blocked = 5,
  BelowGround = 6,
  TooHigh = 7,
  BadMode = 8,
  TooManyPieces = 9,
  CircuitClosed = 10,
  NotAtEnd = 11,
  StoreFull = 12,
  NotOwned = 13,
  InsufficientFunds = 14,
  PieceNotAllowed = 15,
}

/** The horizontal shape of a piece in the vocabulary of the build controls. */
export type PieceShape =
  | 'station'
  | 'straight'
  | 'smallLeft'
  | 'smallRight'
  | 'mediumLeft'
  | 'mediumRight'
  | 'largeLeft'
  | 'largeRight'
  | 'loopLeft'
  | 'loopRight'
  | 'sBendLeft'
  | 'sBendRight'
  | 'corkscrewLeft'
  | 'corkscrewRight'
  | 'smallHelixLeftDown'
  | 'smallHelixRightDown'
  | 'smallHelixLeftUp'
  | 'smallHelixRightUp'
  | 'largeHelixLeftDown'
  | 'largeHelixRightDown'
  | 'largeHelixLeftUp'
  | 'largeHelixRightUp';

/** A placeable track piece type; geometry lives in the shared sample table (see catalog.ts). */
export interface TrackPieceDef {
  id: number;
  name: string;
  shape: PieceShape;
  flags: number;
  entrySlope: Slope;
  exitSlope: Slope;
  entryBank: Bank;
  exitBank: Bank;
  /** Quarter turns applied to the heading (0 straight, 1 right, 3 left). */
  headingDelta: number;
  /** Tile offset from the origin tile to the tile the next piece starts in, in the local frame. */
  dx: number;
  dy: number;
  /** Height delta in height levels (Z_STEP units). */
  dz: number;
  /** Build cost in cents. */
  cost: number;
  /** Centre-line length in TILE_UNITS. */
  length: number;
  /** Range of this piece's points (inclusive of the end point) in SAMPLES. */
  sampleStart: number;
  sampleCount: number;
  /** Occupied local tiles with the z-range of the centre line inside each. */
  footprint: readonly FootprintCell[];
}

export interface FootprintCell {
  /** Tile offset from the origin tile, local frame. */
  i: number;
  j: number;
  /** Lowest/highest centre-line z inside the tile, in units relative to the entry height. */
  zMin: number;
  zMax: number;
}

export interface TrackPlacement {
  pieceId: number;
  x: number;
  y: number;
  z: number;
  dir: Direction;
}
