import { Z_STEP } from '../sim/core/constants';
import { PIECES } from '../sim/track/catalog';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { Z_PIXELS } from './projection';

export type CoasterStyle = 'wood' | 'steel';
export type CarPitch = 'flat' | 'up25' | 'up60' | 'down25' | 'down60';

/** Simulation ticks each flat-ride animation frame is shown for. */
export const TICKS_PER_ANIMATION_FRAME = 8;

/**
 * Path sprites are drawn for the unrotated camera, so connection bit `d` (world direction `d`) is
 * looked up as bit `d + rotation` for a rotated camera.
 */
export function rotatePathEdges(edges: number, rotation: number): number {
  const turns = ((rotation % 4) + 4) % 4;
  const mask = edges & 0x0f;
  return ((mask << turns) | (mask >> (4 - turns))) & 0x0f;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** Atlas key of a non-track ride for camera rotation `rotation`; animation frames are `#n`. */
export function rideSpriteKey(type: RideType, rotation: number): string {
  const def = RIDE_CATALOG[type];
  return `rides/${slug(def.name)}/view-${((rotation % 4) + 4) % 4}`;
}

export function frameForTick(tick: number, frameCount: number): number {
  return Math.floor(Math.max(0, tick) / TICKS_PER_ANIMATION_FRAME) % Math.max(1, frameCount);
}

export function trackStyleForRide(type: RideType): CoasterStyle {
  switch (type) {
    case RideType.SteelLoopingCoaster:
    case RideType.JuniorRollerCoaster:
    case RideType.MiniatureRailway:
    case RideType.Monorail:
      return 'steel';
    default:
      return 'wood';
  }
}

export interface TrackCellSprite {
  /** Atlas key of the cell's sprite. */
  key: string;
  /** Tile offset of the cell from the piece's origin tile, in world coordinates. */
  dx: number;
  dy: number;
}

/** Per-tile sprites of a placed track piece for the given piece direction and camera rotation. */
export function trackCells(
  pieceType: number,
  dir: number,
  rotation: number,
  style: CoasterStyle,
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

export function carSpriteKey(style: CoasterStyle, heading: number, pitch: CarPitch): string {
  return `vehicles/${style}/car/${pitch}/heading-${((heading % 8) + 8) % 8}`;
}

/**
 * Vertical world offset (in height units) that moves a centred quad so the sprite's anchor pixel
 * sits on the projected point.
 */
export function nativeSpriteWorldOffset(frameHeight: number, anchorY: number): number {
  return ((anchorY - frameHeight / 2) * Z_STEP) / Z_PIXELS;
}
