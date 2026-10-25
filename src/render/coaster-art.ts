import { Z_STEP } from '../sim/core/constants';
import { PIECES } from '../sim/track/catalog';
import { PieceFlag, PieceMode } from '../sim/track/track-types';
import type { TrackPieceDef } from '../sim/track/track-types';
import { RideType } from '../sim/rides/ride-types';

/** Art families of the track rides; each has its own track, supports and cars. */
export const COASTER_FAMILIES = ['wood', 'steel', 'junior', 'mouse'] as const;
export type CoasterFamily = (typeof COASTER_FAMILIES)[number];

/** Animation frames of a chain lift, and ticks each is shown for. */
export const CHAIN_FRAMES = 2;
export const TICKS_PER_CHAIN_FRAME = 4;

const PITCH_NAMES = ['down90', 'down60', 'down25', 'flat', 'up25', 'up60', 'up90'] as const;
const BANK_NAMES = ['level', 'left', 'right', 'inverted'] as const;
export const CAR_PITCH_NAMES = PITCH_NAMES;
export const CAR_BANK_NAMES = BANK_NAMES;

/** Track pieces are drawn in the wood or steel style; Wild Mouse and Junior share those. */
export function trackArt(family: CoasterFamily): 'wood' | 'steel' {
  return family === 'wood' || family === 'mouse' ? 'wood' : 'steel';
}

export function coasterFamily(type: RideType): CoasterFamily | undefined {
  switch (type) {
    case RideType.WoodenCoaster:
      return 'wood';
    case RideType.SteelLoopingCoaster:
      return 'steel';
    case RideType.JuniorRollerCoaster:
      return 'junior';
    case RideType.WildMouseCoaster:
      return 'mouse';
    default:
      return undefined;
  }
}

/** Key suffix of the art a piece shows in a drive mode; empty when the piece has only plain art. */
export function trackVariant(piece: TrackPieceDef, mode: number): string {
  if (mode === PieceMode.ChainLift && piece.flags & PieceFlag.LiftOk) return '+chain';
  if (mode === PieceMode.Brake && piece.flags & PieceFlag.BrakeOk) return '+brake';
  if (mode === PieceMode.BlockBrake && piece.flags & PieceFlag.BrakeOk) return '+block';
  return '';
}

export interface TrackCellSprite {
  /** Atlas key of the cell's sprite; animated sprites end in `#frame`. */
  key: string;
  /** Tile offset of the cell from the piece's origin tile, in world coordinates. */
  dx: number;
  dy: number;
}

/** Per-tile sprites of a placed track piece for the piece direction and camera rotation. */
export function trackCellSprites(
  pieceType: number,
  dir: number,
  rotation: number,
  family: CoasterFamily,
  mode: number,
  tick: number,
): TrackCellSprite[] {
  const piece = PIECES[pieceType];
  if (!piece) return [];
  const turns = ((dir % 4) + 4) % 4;
  const view = (turns + (((rotation % 4) + 4) % 4)) & 3;
  const variant = trackVariant(piece, mode);
  const frame =
    variant === '+chain'
      ? `#${Math.floor(Math.max(0, tick) / TICKS_PER_CHAIN_FRAME) % CHAIN_FRAMES}`
      : '';
  return piece.footprint.map((cell, index) => {
    const [dx, dy] = (
      [
        [cell.i, cell.j],
        [-cell.j, cell.i],
        [-cell.i, -cell.j],
        [cell.j, -cell.i],
      ] as const
    )[turns];
    return {
      key: `track/${trackArt(family)}/${piece.name}${variant}/view-${view}/cell-${index}${frame}`,
      dx,
      dy,
    };
  });
}

/** Atlas key of a car; `heading` is the world eighth-turn heading, `pitch` runs -3..3. */
export function carSpriteKey(
  family: CoasterFamily,
  heading: number,
  pitch: number,
  bank: number,
  rotation: number,
): string {
  const view = (heading + 2 * (((rotation % 4) + 4) % 4)) & 7;
  return `vehicles/${family}/car/${PITCH_NAMES[pitch + 3]}/${BANK_NAMES[bank]}/heading-${view}`;
}

export interface SupportStack {
  /** Whole height levels of column, from the ground up. */
  full: number;
  /** Quarter levels of the capping segment. */
  quarters: number;
}

/**
 * Column needed under a footprint cell of a piece whose entry is at `pieceLevel`, standing on
 * ground at `groundLevel` (both height levels).
 */
export function supportStack(
  pieceType: number,
  cell: number,
  groundLevel: number,
  pieceLevel: number,
): SupportStack {
  const piece = PIECES[pieceType];
  const underside = pieceLevel + (piece?.footprint[cell]?.zMin ?? 0) / Z_STEP;
  const quarters = Math.round((underside - groundLevel) * 4);
  if (quarters <= 0) return { full: 0, quarters: 0 };
  return { full: Math.floor(quarters / 4), quarters: quarters % 4 };
}
