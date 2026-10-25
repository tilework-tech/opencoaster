import { Bank, PieceFlag, Slope } from '../../../src/sim/track/track-types';
import type { TrackPieceDef } from '../../../src/sim/track/track-types';
import { PIECES } from '../../../src/sim/track/catalog';
import { CHAIRLIFT_STYLE } from './chairlift';
import { MINIATURE_RAILWAY_STYLE } from './miniature-railway';
import { MONORAIL_STYLE } from './monorail';
import type { TransportStyle } from './transport-track';

/** Track and vehicle styles of the transport rides, one per ride family. */
export const TRANSPORT_STYLES: readonly TransportStyle[] = [
  MINIATURE_RAILWAY_STYLE,
  MONORAIL_STYLE,
  CHAIRLIFT_STYLE,
];

/**
 * Pieces drawn for transport rides: no inversions, no steep (60 degree) slopes and no banking.
 * The shared atlas is capped at 2048x4096, and banked, turned and looping pieces for all three
 * styles do not fit alongside the existing sprites, so those pieces fall back to the procedural
 * cell.
 */
export const TRANSPORT_PIECES: readonly TrackPieceDef[] = PIECES.filter(
  (piece) =>
    (piece.flags & PieceFlag.Inverted) === 0 &&
    piece.entrySlope !== Slope.Up60 &&
    piece.entrySlope !== Slope.Down60 &&
    piece.exitSlope !== Slope.Up60 &&
    piece.exitSlope !== Slope.Down60 &&
    piece.headingDelta === 0 &&
    piece.entryBank === Bank.None &&
    piece.exitBank === Bank.None,
);
