import { Z_STEP } from '../sim/core/constants';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { rideFootprintTiles } from '../sim/rides/ride-footprint';
import { RidePhase } from '../sim/rides/ride-store';
import { PathFlag, PATH_ADDITION_BROKEN, SLOPE_DIR_SHIFT } from '../sim/map/tile-map';
import type { MapData } from './renderer';
import { Z_PIXELS, rotateDirection } from './projection';
import type { Rotation } from './projection';

/** Native display size of litter marks over a projected path tile. */
export const LITTER_SPRITE_SIZE = { width: 6, height: 3 } as const;

/** Simulation ticks each flat-ride animation frame is shown for. */
export const TICKS_PER_ANIMATION_FRAME = 8;
/** Full scale of `RideInfo.PhaseProgress`. */
export const PHASE_PROGRESS_MAX = 1000;
/** Category and stable slug used by generated ride sprite pages. */
export function rideSpriteName(type: RideType): string {
  const definition = RIDE_CATALOG[type];
  if (!definition) return '';
  const slug = definition.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const group =
    definition.category === 'gentle' || definition.category === 'thrill'
      ? 'rides/flat'
      : definition.category === 'transport' || definition.category === 'water'
        ? 'transport'
        : 'stalls';
  return `${group}/${slug}`;
}

export function facilityFacingFromPaths(x: number, y: number, map: MapData): number {
  const adjacent = [false, false, false, false];
  const count = Math.min(map.pathCount ?? 0, Math.floor((map.pathElements?.length ?? 0) / 6));
  for (let index = 0; index < count; index++) {
    const offset = index * 6;
    if ((map.pathElements![offset + 3] & PathFlag.Queue) !== 0) continue;
    const dx = map.pathElements![offset] - x;
    const dy = map.pathElements![offset + 1] - y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
    adjacent[dx === 1 ? 0 : dy === 1 ? 1 : dx === -1 ? 2 : 3] = true;
  }
  return adjacent.findIndex(Boolean) < 0 ? 1 : adjacent.findIndex(Boolean);
}

export function facilitySpriteKey(type: RideType, facing: number, rotation: number): string {
  const def = RIDE_CATALOG[type];
  const slug = def.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `stalls/${slug}/facing-${((facing % 4) + 4) % 4}/view-${((rotation % 4) + 4) % 4}`;
}

export function rideHutFacing(rideX: number, rideY: number, partX: number, partY: number): number {
  const dx = partX - rideX;
  const dy = partY - rideY;
  if (dx === 1 && dy === 0) return 0;
  if (dx === 0 && dy === 1) return 1;
  if (dx === -1 && dy === 0) return 2;
  if (dx === 0 && dy === -1) return 3;
  return 1;
}

export type ObservationTowerPart = 'base' | 'shaft' | 'top' | 'cabin';

export function observationTowerPartSpriteKey(
  part: ObservationTowerPart,
  rotation: number,
): string {
  const view = Number.isInteger(rotation) && rotation >= 0 && rotation <= 3 ? rotation : 0;
  return `${rideSpriteName(RideType.ObservationTower)}/parts/${part}/view-${view}`;
}

/**
 * Facing (0 = +x, 1 = +y, 2 = -x, 3 = -y) of a hut on (`partX`, `partY`) toward the ride tile it
 * touches. Rides without a footprint list (stalls, track rides) are measured from their anchor.
 */
export function rideHutFacingForFootprint(
  type: RideType,
  rideX: number,
  rideY: number,
  rideDir: number,
  partX: number,
  partY: number,
): number {
  const def = RIDE_CATALOG[type];
  if (!def || def.usesTrack || def.footprint.length <= 1)
    return rideHutFacing(rideX, rideY, partX, partY);
  for (const [tx, ty] of rideFootprintTiles(def, rideX, rideY, rideDir))
    if (Math.abs(partX - tx) + Math.abs(partY - ty) === 1)
      return rideHutFacing(tx, ty, partX, partY);
  return rideHutFacing(rideX, rideY, partX, partY);
}

export function rideHutSpriteKey(
  type: RideType,
  part: 'entrance' | 'exit',
  facing: number,
  rotation: number,
): string {
  const def = RIDE_CATALOG[type];
  const slug = def.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const family =
    def.category !== 'coaster'
      ? ''
      : slug.includes('junior')
        ? 'junior'
        : slug.includes('mouse')
          ? 'mouse'
          : slug.includes('wood')
            ? 'wood'
            : 'steel';
  const group = family
    ? `rides/coaster/${family}`
    : def.category === 'transport' || def.category === 'water'
      ? 'transport'
      : 'rides/flat';
  const categorySegment = family ? '' : `${def.category}/`;
  const facingView = `facing-${((facing % 4) + 4) % 4}/view-${((rotation % 4) + 4) % 4}`;
  return `${group}/stations/${categorySegment}${part}/${facingView}`;
}

/** Atlas key for a non-track ride at the current camera rotation. */
export function rideSpriteKey(type: RideType, rotation: number): string {
  const view = Number.isInteger(rotation) && rotation >= 0 && rotation <= 3 ? rotation : 0;
  return `${rideSpriteName(type)}/view-${view}`;
}

/** Whole-ride view used in the ride window; world rendering uses the footprint cell slices. */
export function ridePreviewSpriteKey(
  type: RideType,
  rideDir: number,
  cameraRotation: number,
): string {
  const view = (rideDir + cameraRotation) & 3;
  return `${rideSpriteName(type)}/preview/view-${view}`;
}

/**
 * Sprite view of a flat-ride slice. Slices are cut from the model turned by this many quarter
 * turns: the ride's own orientation (`rotateTile`) followed by the camera rotation, which turn
 * tile offsets in the same sense.
 */
export function rideCellView(cameraRotation: number, rideDir: number): number {
  return rotateDirection(rideDir & 3, (cameraRotation & 3) as Rotation);
}

/**
 * Atlas key of the slice of a flat ride over footprint tile `cellIndex` (an index into the
 * unrotated `RIDE_CATALOG[type].footprint`). Draw it at that tile's centre; slices of tiles that
 * hold no geometry are not generated, so callers must tolerate a missing key.
 */
export function rideCellSpriteKey(
  type: RideType,
  cellIndex: number,
  rideDir: number,
  cameraRotation: number,
): string {
  return `${rideSpriteName(type)}/view-${rideCellView(cameraRotation, rideDir)}/cell-${cellIndex}`;
}

/**
 * Frame zero is the idle pose; active cycle frames show riders. Sprites with more than nine
 * frames (the Swinging Ship) spread their whole profile over the Running phase using
 * `phaseProgress`, a permille of the phase elapsed.
 */
export function rideSpriteFrame(
  phase: RidePhase | number,
  tick: number,
  frameCount: number,
  phaseProgress?: number,
): number {
  if (frameCount > 9) {
    if (phase !== RidePhase.Running) return 0;
    const progress = Math.min(Math.max(0, phaseProgress ?? 0), PHASE_PROGRESS_MAX);
    return (
      1 + Math.min(frameCount - 2, Math.floor((progress * (frameCount - 1)) / PHASE_PROGRESS_MAX))
    );
  }
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

const PATH_SURFACES: readonly PathSurface[] = ['tarmac', 'crazy-paving', 'dirt'];

/** Surface style of a footpath element, from its PathFlag bits and surface index. */
export function pathElementSurface(flags: number, surface: number): PathSurface {
  return flags & PathFlag.Queue ? 'queue' : (PATH_SURFACES[surface] ?? 'tarmac');
}

/** Atlas sprite for a footpath element at the camera rotation, from its PathFlag bits and surface index. */
export function pathElementSprite(flags: number, surface: number, rotation: number): string {
  const sloped = (flags & PathFlag.Sloped) !== 0;
  const direction = (flags & PathFlag.SlopeDir) >> SLOPE_DIR_SHIFT;
  const edges = (flags & PathFlag.Edges) | ((flags & PathFlag.Forced) >> 4);
  return pathSpriteName(
    pathElementSurface(flags, surface),
    edges,
    sloped ? direction : undefined,
    rotation,
  );
}

/**
 * Rail sprites of a flat queue piece to draw after the people on its tile: one for each edge
 * facing the camera that the piece does not join to a neighbour. Each carries the world
 * direction of its edge so the caller can sort it.
 */
export function queueRailSprites(
  flags: number,
  rotation: number,
): Array<{ sprite: string; worldDir: number }> {
  if (!(flags & PathFlag.Queue) || flags & PathFlag.Sloped) return [];
  const turns = ((rotation % 4) + 4) % 4;
  const edges = (flags & PathFlag.Edges) | ((flags & PathFlag.Forced) >> 4);
  const out: Array<{ sprite: string; worldDir: number }> = [];
  for (let view = 0; view < 2; view++) {
    const worldDir = (view - turns + 4) & 3;
    if (edges & (1 << worldDir)) continue;
    out.push({ sprite: `paths/queue/rail-${view}`, worldDir });
  }
  return out;
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

export function scenerySpriteName(name: string, rotation = 0): string {
  if (name === 'tree-palm' || name === 'tree-cactus')
    return `trees/${name}/view-${((rotation % 4) + 4) % 4}`;
  return name.startsWith('tree-') ? `trees/${name}` : `scenery/${name}`;
}

export function wallSpriteName(
  name: string,
  edge: number,
  slopeMask: number,
  view: number,
): string {
  return `scenery/${name}/edge-${((edge % 4) + 4) % 4}/slope-${slopeMask & 15}/view-${((view % 4) + 4) % 4}`;
}

/** Stable tile-based shrub variant with a camera-specific generated sprite. */
export function shrubSpriteName(x: number, y: number, rotation: number): string {
  const variant = (((x * 3 + y * 5) % 4) + 4) % 4;
  const view = ((rotation % 4) + 4) % 4;
  return `scenery/shrub/variant-${variant}/view-${view}`;
}

/** Deterministic color and camera-view key for a flowerbed on a map tile. */
export function flowerBedSpriteName(x: number, y: number, rotation: number, slopeMask = 0): string {
  const variant = (((x + 2 * y) % 4) + 4) % 4;
  const view = ((rotation % 4) + 4) % 4;
  return slopeMask === 0
    ? `scenery/flower-bed/variant-${variant}/view-${view}`
    : `scenery/flower-bed/slope-${slopeMask & 0x0f}/variant-${variant}/view-${view}`;
}

export function pathAdditionSpriteName(flags: number, rotation: number, data: number): string {
  const view = Number.isInteger(rotation) && rotation >= 0 && rotation <= 3 ? rotation : 0;
  if (flags & PathFlag.Shelter) return `scenery/shelter/view-${view}`;
  if (flags & PathFlag.Bench)
    return data & PATH_ADDITION_BROKEN
      ? `scenery/bench-broken/view-${view}`
      : `scenery/bench/view-${view}`;
  if (flags & PathFlag.Bin)
    return data & PATH_ADDITION_BROKEN
      ? `scenery/bin-broken/view-${view}`
      : `scenery/bin/view-${view}`;
  if (flags & PathFlag.Lamp)
    return data & PATH_ADDITION_BROKEN
      ? `scenery/lamp-broken/view-${view}`
      : `scenery/lamp/view-${view}`;
  return '';
}

export function litterSpriteName(kind: number, rotation: number): string {
  const view = Number.isInteger(rotation) && rotation >= 0 && rotation <= 3 ? rotation : 0;
  return `litter/${kind === 1 ? 'vomit' : 'trash'}/view-${view}`;
}

export function spriteAnchorWorldOffset(
  frameHeight: number,
  anchorY: number,
  renderedHeight: number,
): number {
  return ((anchorY / frameHeight - 0.5) * renderedHeight * Z_STEP) / Z_PIXELS;
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

/**
 * Horizontal screen shift (pixels) that moves a quad centred on the projected point so that the
 * sprite's anchor pixel lands on that point.
 */
export function nativeSpriteAnchorShift(frameWidth: number, anchorX: number): number {
  return frameWidth / 2 - anchorX;
}

const PATH_SUPPORT_FOOTING = 'paths/support/base';
const NO_PATH = 255;
const lowestBases = new WeakMap<Int32Array, Uint8Array>();

/** Per tile, the base level of its lowest footpath element (255 where the tile has none). */
export function lowestPathBases(map: MapData): Uint8Array {
  const paths = map.pathElements;
  const cached = paths ? lowestBases.get(paths) : undefined;
  if (cached) return cached;
  const lowest = new Uint8Array(map.width * map.height).fill(NO_PATH);
  const count = Math.min(map.pathCount ?? 0, paths ? paths.length / 6 : 0);
  for (let e = 0; e < count; e++) {
    const tile = paths![e * 6 + 1]! * map.width + paths![e * 6]!;
    if (paths![e * 6 + 2]! < lowest[tile]!) lowest[tile] = paths![e * 6 + 2]!;
  }
  if (paths) lowestBases.set(paths, lowest);
  return lowest;
}

/** One support sprite of a raised footpath and the height level it stands on. */
export interface PathSupport {
  sprite: string;
  level: number;
}

/**
 * Posts that hold a footpath piece at `base` up from the ground at `ground`: a footing, one column
 * per level and a framed cap under the slab, in the path's surface colours. A tile whose footpath
 * rests on the ground, or that has a lower footpath beneath it, gets none, so guests walk through
 * the space under a bridge.
 */
export function pathSupports(
  ground: number,
  base: number,
  lowest: number,
  surface: PathSurface = 'tarmac',
): PathSupport[] {
  if (base <= ground || lowest < base) return [];
  const supports: PathSupport[] = [{ sprite: PATH_SUPPORT_FOOTING, level: ground }];
  for (let level = ground; level < base; level++)
    supports.push({
      sprite: `paths/support/${surface}/${level === base - 1 ? 'cap' : 'column'}`,
      level,
    });
  return supports;
}
