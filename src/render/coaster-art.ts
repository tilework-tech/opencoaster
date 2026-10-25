import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { PIECES, SAMPLES } from '../sim/track/catalog';
import { PieceFlag, PieceMode } from '../sim/track/track-types';
import type { TrackPieceDef } from '../sim/track/track-types';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';

/** Art families of the track rides; each has its own track, supports and cars. */
export const COASTER_FAMILIES = ['wood', 'steel', 'junior', 'mouse'] as const;
export type CoasterFamily = (typeof COASTER_FAMILIES)[number];
export type WaterRideFamily = 'log-flume' | 'river-rapids';
export type TrackRideFamily = CoasterFamily | WaterRideFamily;

/** Animation frames of a chain lift, and ticks each is shown for. */
export const CHAIN_FRAMES = 2;
export const TICKS_PER_CHAIN_FRAME = 4;

const PITCH_NAMES = ['down90', 'down60', 'down25', 'flat', 'up25', 'up60', 'up90'] as const;
const BANK_NAMES = ['level', 'left', 'right', 'inverted'] as const;
export const CAR_PITCH_NAMES = PITCH_NAMES;
export const CAR_BANK_NAMES = BANK_NAMES;

const FAMILY_RIDES: Record<CoasterFamily, RideType> = {
  wood: RideType.WoodenCoaster,
  steel: RideType.SteelLoopingCoaster,
  junior: RideType.JuniorRollerCoaster,
  mouse: RideType.WildMouseCoaster,
};

export type TrackArt = 'wood' | 'steel' | 'junior';
export const TRACK_ARTS: readonly TrackArt[] = ['wood', 'steel', 'junior'];

/** Track and station art a family draws with; Wild Mouse rides on timber track. */
export function trackArt(family: CoasterFamily): TrackArt {
  return family === 'mouse' ? 'wood' : family;
}

/** Catalog pieces a family's ride type can build, which are the only ones it needs art for. */
export function familyPieces(family: CoasterFamily): TrackPieceDef[] {
  const rules = RIDE_CATALOG[FAMILY_RIDES[family]].trackRules;
  return PIECES.filter((piece) => {
    if (rules?.allowedPieces && !rules.allowedPieces.includes(piece.id)) return false;
    const steep = Math.abs(piece.entrySlope) === 2 || Math.abs(piece.exitSlope) === 2;
    if (steep && !rules?.steepSlopes) return false;
    return !(piece.flags & PieceFlag.Inverted && !rules?.inversions);
  });
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

export function trackedRideFamily(type: RideType): TrackRideFamily | undefined {
  return (
    coasterFamily(type) ??
    (type === RideType.LogFlume
      ? 'log-flume'
      : type === RideType.RiverRapids
        ? 'river-rapids'
        : undefined)
  );
}

export type TransportFamily = 'chairlift' | 'miniature-railway' | 'monorail';

export function transportFamily(type: RideType): TransportFamily | undefined {
  switch (type) {
    case RideType.Chairlift:
      return 'chairlift';
    case RideType.MiniatureRailway:
      return 'miniature-railway';
    case RideType.Monorail:
      return 'monorail';
    default:
      return undefined;
  }
}

export function transportTrackCells(
  pieceType: number,
  dir: number,
  rotation: number,
  style: TransportFamily,
): TrackCellSprite[] {
  const piece = PIECES[pieceType];
  if (!piece) return [];
  const turns = ((dir % 4) + 4) % 4;
  const view = (turns + (((rotation % 4) + 4) % 4)) & 3;
  return piece.footprint.map((cell, index) => {
    const [dx, dy] = (
      [
        [cell.i, cell.j],
        [-cell.j, cell.i],
        [-cell.i, -cell.j],
        [cell.j, -cell.i],
      ] as const
    )[turns];
    return { key: `track/${style}/${piece.name}/view-${view}/cell-${index}`, dx, dy };
  });
}

export function transportCarSpriteKey(
  style: TransportFamily,
  heading: number,
  pitch: number,
  rotation: number,
): string {
  const pitchName = (['down60', 'down25', 'flat', 'up25', 'up60'] as const)[
    Math.max(0, Math.min(4, pitch + 2))
  ];
  const view = (heading + 2 * (((rotation % 4) + 4) % 4)) & 7;
  return `vehicles/${style}/car/${pitchName}/heading-${view}`;
}

/** Key suffix of the art a piece shows in a drive mode; empty when the piece has only plain art. */
export function trackVariant(piece: TrackPieceDef, mode: number): string {
  if (mode === PieceMode.ChainLift && piece.flags & PieceFlag.LiftOk) return '+chain';
  if (mode === PieceMode.WaterLift && piece.flags & PieceFlag.LiftOk) return '+water-lift';
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
  family: TrackRideFamily,
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
      key:
        family === 'log-flume' || family === 'river-rapids'
          ? `rides/water/${family}/track/${piece.name}${variant}/view-${view}/cell-${index}${frame}`
          : `rides/coaster/${trackArt(family)}/track/${piece.name}${variant}/view-${view}/cell-${index}${frame}`,
      dx,
      dy,
    };
  });
}

/** Atlas key of a car; `heading` is the world eighth-turn heading, `pitch` runs -3..3. */
export function carSpriteKey(
  family: TrackRideFamily,
  heading: number,
  pitch: number,
  bank: number,
  rotation: number,
): string {
  const view = (heading + 2 * (((rotation % 4) + 4) % 4)) & 7;
  return family === 'log-flume' || family === 'river-rapids'
    ? `rides/water/${family}/vehicles/car/${PITCH_NAMES[pitch + 3]}/heading-${view}`
    : `rides/coaster/${family}/vehicles/car/${PITCH_NAMES[pitch + 3]}/${BANK_NAMES[bank]}/heading-${view}`;
}

/** Height levels between the track centre line and the underside of its bed. */
const BED_LEVELS = 0.25;

/** Centre-line height (world z units) of the sample nearest the middle of a footprint cell. */
function centreHeight(piece: TrackPieceDef, cell: number): number {
  const { i, j } = piece.footprint[cell] ?? { i: 0, j: 0 };
  let best = piece.sampleStart;
  let bestDistance = Infinity;
  for (let k = 0; k < piece.sampleCount; k++) {
    const at = piece.sampleStart + k;
    const distance =
      (SAMPLES.x[at] / TILE_UNITS - 0.5 - i) ** 2 + (SAMPLES.y[at] / TILE_UNITS - 0.5 - j) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = at;
    }
  }
  return SAMPLES.z[best];
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
  const underside = pieceLevel + (piece ? centreHeight(piece, cell) : 0) / Z_STEP - BED_LEVELS;
  const quarters = Math.round((underside - groundLevel) * 4);
  if (quarters <= 0) return { full: 0, quarters: 0 };
  return { full: Math.floor(quarters / 4), quarters: quarters % 4 };
}

/** Pieces a track art needs sprites for: everything any family using it can build. */
export function artPieces(art: TrackArt): TrackPieceDef[] {
  const wanted = new Set<number>();
  for (const family of COASTER_FAMILIES)
    if (trackArt(family) === art) for (const piece of familyPieces(family)) wanted.add(piece.id);
  return PIECES.filter((piece) => wanted.has(piece.id));
}
