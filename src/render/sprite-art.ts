import { Z_STEP } from '../sim/core/constants';
import { PIECES } from '../sim/track/catalog';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { Z_PIXELS } from './projection';
import { PathFlag } from '../sim/map/tile-map';

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
  const category = def.category === 'transport' ? 'transport' : 'flat-rides';
  return `${category}/${slug(def.name)}/view-${((rotation % 4) + 4) % 4}`;
}

/** Atlas key for a facility whose customer-facing side points toward `facing`. */
export function facilitySpriteKey(type: RideType, facing: number, rotation: number): string {
  const def = RIDE_CATALOG[type];
  return `stalls/${slug(def.name)}/facing-${((facing % 4) + 4) % 4}/view-${((rotation % 4) + 4) % 4}`;
}

/** Selects the path-facing side for a facility from the five-value path element records. */
export function facilityFacingFromPaths(
  x: number,
  y: number,
  pathElements: Int32Array | undefined,
  pathCount: number,
): number {
  if (!pathElements) return 1;
  const adjacent = [false, false, false, false];
  const count = Math.min(pathCount, Math.floor(pathElements.length / 5));
  for (let index = 0; index < count; index++) {
    const offset = index * 5;
    if ((pathElements[offset + 3] & PathFlag.Queue) !== 0) continue;
    const dx = pathElements[offset] - x;
    const dy = pathElements[offset + 1] - y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
    const direction = dx === 1 ? 0 : dy === 1 ? 1 : dx === -1 ? 2 : 3;
    adjacent[direction] = true;
  }
  for (let direction = 0; direction < adjacent.length; direction++)
    if (adjacent[direction]) return direction;
  return 1;
}

/** Atlas key for a category-themed ride entrance or exit hut. */
export function rideHutSpriteKey(
  type: RideType,
  part: 'entrance' | 'exit',
  facing: number,
  rotation: number,
): string {
  const category = RIDE_CATALOG[type].category;
  const group =
    category === 'transport'
      ? 'transport'
      : category === 'coaster'
        ? 'coaster-steel'
        : 'flat-rides';
  return `${group}/stations/${category}/${part}/facing-${((facing % 4) + 4) % 4}/view-${((rotation % 4) + 4) % 4}`;
}

/** The outward direction from a ride footprint to its entrance or exit tile. */
export function rideHutFacing(rideX: number, rideY: number, partX: number, partY: number): number {
  const dx = partX - rideX;
  const dy = partY - rideY;
  if (dx === 1 && dy === 0) return 0;
  if (dx === 0 && dy === 1) return 1;
  if (dx === -1 && dy === 0) return 2;
  if (dx === 0 && dy === -1) return 3;
  return 1;
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
    return { key: `coaster-${style}/${piece.name}/view-${view}/cell-${index}`, dx, dy };
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
