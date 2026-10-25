import { Z_STEP } from '../sim/core/constants';
import { RIDE_CATALOG } from '../sim/rides/ride-types';
import type { RideType } from '../sim/rides/ride-types';
import { RidePhase } from '../sim/rides/ride-store';
import { Z_PIXELS } from './projection';

/** Simulation ticks each flat-ride animation frame is shown for. */
export const TICKS_PER_ANIMATION_FRAME = 8;

/** Category and stable slug used by generated ride sprite pages. */
export function rideSpriteName(type: RideType): string {
  const definition = RIDE_CATALOG[type];
  if (!definition) return '';
  const slug = definition.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const group =
    definition.category === 'gentle' || definition.category === 'thrill'
      ? 'flat-rides'
      : definition.category === 'transport' || definition.category === 'water'
        ? 'transport'
        : 'stalls';
  return `${group}/${slug}`;
}

/** Atlas key for a non-track ride at the current camera rotation. */
export function rideSpriteKey(type: RideType, rotation: number): string {
  const view = Number.isInteger(rotation) && rotation >= 0 && rotation <= 3 ? rotation : 0;
  return `${rideSpriteName(type)}/view-${view}`;
}

/** Frame zero is the idle pose; active cycle frames show riders. */
export function rideSpriteFrame(
  phase: RidePhase | number,
  tick: number,
  frameCount: number,
): number {
  if (
    frameCount < 2 ||
    (phase !== RidePhase.Loading && phase !== RidePhase.Running && phase !== RidePhase.Unloading)
  )
    return 0;
  return 1 + (Math.floor(Math.max(0, tick) / TICKS_PER_ANIMATION_FRAME) % (frameCount - 1));
}

export const TERRAIN_SLOPE_NAMES = Array.from(
  { length: 16 },
  (_, index) => `shape-${index.toString(16).padStart(2, '0')}`,
);

export type TerrainSurface = 'grass' | 'dirt' | 'sand' | 'rock';
export type PathSurface = 'tarmac' | 'crazy-paving' | 'dirt' | 'queue';

export function terrainSpriteName(surface: TerrainSurface, slopeMask: number): string {
  const shape = Number.isInteger(slopeMask) && slopeMask >= 0 && slopeMask <= 15 ? slopeMask : 0;
  return `terrain/${surface}/shape-${shape.toString(16).padStart(2, '0')}`;
}

export function terrainSurfaceSpriteName(surface: TerrainSurface): string {
  return `terrain/${surface}/surface`;
}

export function terrainCliffSpriteName(surface: TerrainSurface, direction: number): string {
  const edge = Number.isInteger(direction) && direction >= 0 && direction <= 3 ? direction : 0;
  return `terrain/${surface}/cliff-face-${edge}`;
}

/**
 * Path sprites are rendered for the unrotated camera; a connection on world side `d` is looked up
 * as side `d + rotation`, and a ramp rising toward world direction `d` as direction `d + rotation`.
 */
export function pathSpriteName(
  surface: PathSurface,
  edges: number,
  slopeDirection?: number,
  rotation = 0,
): string {
  const turns = ((rotation % 4) + 4) % 4;
  if (slopeDirection !== undefined && slopeDirection >= 0 && slopeDirection <= 3)
    return `paths/${surface}/ramp-${(slopeDirection + turns) & 3}`;
  const mask = edges & 0x0f;
  const viewMask = ((mask << turns) | (mask >> (4 - turns))) & 0x0f;
  return `paths/${surface}/connection-${viewMask.toString(16).padStart(2, '0')}`;
}

/** Palette-cycle frames of the water texture. */
export const WATER_FRAMES = 8;

export function waterFrameIndex(tick: number): number {
  return Math.floor(Math.max(0, tick) / 8) % WATER_FRAMES;
}

export function waterSpriteName(frame: number): string {
  return `water/surface#${((frame % WATER_FRAMES) + WATER_FRAMES) % WATER_FRAMES}`;
}

/**
 * How water is drawn against the terrain, in height units (64 per level, 16px): the surface sits
 * `surfaceInset` below the recorded water level so the shore reads as a bank, and the colour
 * changes with depth below the surface (foam line, shallows, deep water).
 */
export const WATER_BANK = {
  surfaceInset: 32,
  foamDepth: 5,
  shallowDepth: 24,
  deepDepth: 96,
};

export function scenerySpriteName(name: string): string {
  return name.startsWith('tree-') ? `trees/${name}` : `scenery/${name}`;
}

export function spriteViewName(name: string, rotation: number): string {
  const view = Number.isInteger(rotation) && rotation >= 0 && rotation <= 3 ? rotation : 0;
  return `${name}/view-${view}`;
}

export function atlasFrameOrFallback<T>(
  sprites: Record<string, { frames: readonly T[] }> | undefined,
  requested: string,
  fallback: T,
): T {
  return sprites?.[requested]?.frames[0] ?? fallback;
}

/**
 * Vertical world offset (height units) that moves a quad centred on the projected point so that
 * the sprite's anchor pixel lands on that point.
 */
export function nativeSpriteWorldOffset(frameHeight: number, anchorY: number): number {
  return ((anchorY - frameHeight / 2) * Z_STEP) / Z_PIXELS;
}
