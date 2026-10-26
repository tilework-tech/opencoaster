import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { PathFlag } from '../sim/map/tile-map';
import type { MapData } from './renderer';
import type { Rotation } from './projection';

/**
 * The painter's depth key both renderers share. A key is `2 * (x + y)` in rotated tile units
 * minus the height in levels, so equal keys lie on one screen row of ground. Larger keys are
 * drawn later, in front.
 */

/** Added to a person's key so a tie with the surface they stand on resolves in their favour. */
const PERSON_BIAS = 0.5;
/** Offset of an object filling its tile, from the tile-centre key: after people one tile behind it. */
export const SOLID_BIAS = 0.25;
/** Offset of flat ground cover from the tile-centre key: just after the terrain, under people. */
export const GROUND_COVER_BIAS = -1.75;

/** How far above a surface, in levels, a person's feet may be and still count as on it. */
const FEET_TOLERANCE = 0.3;
/** How close, in tiles, a person must be to a neighbouring tile for its slab to reach their sprite. */
const SPRITE_REACH = 0.3;
/** Gap kept between a surface and the first thing that may stand on it. */
const SURFACE_GAP = 0.5;

/** Rotated `x + y` of a world-unit position: larger is nearer the camera. */
export function rotatedPositionSum(
  x: number,
  y: number,
  map: { width: number; height: number },
  rotation: Rotation,
): number {
  const tx = x / TILE_UNITS;
  const ty = y / TILE_UNITS;
  switch (rotation) {
    case 0:
      return tx + ty;
    case 1:
      return map.height - ty + tx;
    case 2:
      return map.width - tx + map.height - ty;
    case 3:
      return ty + map.width - tx;
  }
}

/** Key of a tile's terrain, taken at the tile's rearmost corner. */
export function terrainDepth(
  map: { width: number; height: number },
  rotation: Rotation,
  x: number,
  y: number,
  height: number,
): number {
  return 2 * rearCornerSum(map, rotation, x, y) - height;
}

/**
 * Key of a footpath slab: low enough that anything standing anywhere on the slab, including the
 * high corner of a ramp, is drawn after it, and never below the terrain it sits on.
 */
export function pathSlabDepth(
  map: { width: number; height: number },
  rotation: Rotation,
  x: number,
  y: number,
  base: number,
  flags: number,
  terrainHeight: number,
): number {
  const sloped = (flags & PathFlag.Sloped) !== 0;
  const direction = (flags & PathFlag.SlopeDir) >> 10;
  let lowest = Infinity;
  for (let cy = 0; cy <= 1; cy++) {
    for (let cx = 0; cx <= 1; cx++) {
      const along = sloped ? ((direction & 1) === 0 ? cx : cy) : 0;
      const rise = sloped ? (direction >= 2 ? 1 - along : along) : 0;
      const sum = rotatedPositionSum((x + cx) * TILE_UNITS, (y + cy) * TILE_UNITS, map, rotation);
      lowest = Math.min(lowest, 2 * sum - (base + rise));
    }
  }
  return Math.max(
    lowest - SURFACE_GAP,
    terrainDepth(map, rotation, x, y, terrainHeight) + SURFACE_GAP,
  );
}

/** The key of the ground a person stands on, per tile, for one map and camera rotation. */
export class SurfaceDepths {
  private offsets = new Int32Array(0);
  private indices = new Int32Array(0);
  private slabs = new Float64Array(0);
  private builtFor: MapData | null = null;
  private rotation: Rotation = 0;

  /** Rebuilds the per-tile slab keys when the map or rotation changed. */
  prepare(map: MapData, rotation: Rotation): void {
    if (this.builtFor === map && this.rotation === rotation) return;
    this.builtFor = map;
    this.rotation = rotation;
    const paths = map.pathElements;
    const count = Math.min(map.pathCount ?? 0, paths ? Math.floor(paths.length / 6) : 0);
    const tiles = map.width * map.height;
    this.offsets = new Int32Array(tiles + 1);
    this.indices = new Int32Array(count);
    this.slabs = new Float64Array(count);
    if (!paths) return;
    for (let i = 0; i < count; i++) {
      const tile = paths[i * 6 + 1]! * map.width + paths[i * 6]!;
      if (tile >= 0 && tile < tiles) this.offsets[tile + 1] = this.offsets[tile + 1]! + 1;
    }
    for (let tile = 1; tile <= tiles; tile++)
      this.offsets[tile] = this.offsets[tile]! + this.offsets[tile - 1]!;
    const cursor = this.offsets.slice(0, -1);
    for (let i = 0; i < count; i++) {
      const x = paths[i * 6]!;
      const y = paths[i * 6 + 1]!;
      const tile = y * map.width + x;
      if (tile < 0 || tile >= tiles) continue;
      this.indices[cursor[tile]!] = i;
      cursor[tile] = cursor[tile]! + 1;
      this.slabs[i] = pathSlabDepth(
        map,
        rotation,
        x,
        y,
        paths[i * 6 + 2]!,
        paths[i * 6 + 3]!,
        map.heights[tile]!,
      );
    }
  }

  /**
   * Key of the highest ground a person at world position (x, y, z) must be drawn over: the
   * terrain of their tile, and every footpath slab in the 3x3 tiles around them that lies at or
   * below their feet. Ground at or below the feet can never hide a person, so none of it may be
   * drawn after them. Call `prepare` first.
   */
  surfaceAt(map: MapData, x: number, y: number, z: number): number {
    const tx = Math.min(map.width - 1, Math.max(0, Math.floor(x / TILE_UNITS)));
    const ty = Math.min(map.height - 1, Math.max(0, Math.floor(y / TILE_UNITS)));
    const paths = map.pathElements;
    const feet = z / Z_STEP + FEET_TOLERANCE;
    let floor = terrainDepth(map, this.rotation, tx, ty, map.heights[ty * map.width + tx]!) + 0.25;
    if (!paths) return floor;
    for (let ny = Math.max(0, ty - 1); ny <= Math.min(map.height - 1, ty + 1); ny++) {
      for (let nx = Math.max(0, tx - 1); nx <= Math.min(map.width - 1, tx + 1); nx++) {
        const tile = ny * map.width + nx;
        const own = nx === tx && ny === ty;
        if (!own && !withinReach(x, y, nx, ny)) continue;
        for (let at = this.offsets[tile]!; at < this.offsets[tile + 1]!; at++) {
          const element = this.indices[at]!;
          const base = paths[element * 6 + 2]!;
          const rise = (paths[element * 6 + 3]! & PathFlag.Sloped) !== 0 ? 1 : 0;
          if ((own ? base : base + rise) <= feet && this.slabs[element]! > floor)
            floor = this.slabs[element]!;
        }
      }
    }
    return floor;
  }
}

/**
 * Key of a person at a world position. Never below the surface they stand on, so terrain and
 * footpath slabs cannot paint over their feet, whatever the slope.
 */
export function personDepth(
  map: MapData,
  rotation: Rotation,
  surfaces: SurfaceDepths,
  x: number,
  y: number,
  z: number,
): number {
  const own = 2 * rotatedPositionSum(x, y, map, rotation) - z / Z_STEP + PERSON_BIAS;
  return Math.max(own, surfaces.surfaceAt(map, x, y, z) + SURFACE_GAP);
}

function rearCornerSum(
  map: { width: number; height: number },
  rotation: Rotation,
  x: number,
  y: number,
): number {
  // Rearmost corner of the tile in view space: the corner with the smallest rotated sum.
  let lowest = Infinity;
  for (let cy = 0; cy <= 1; cy++)
    for (let cx = 0; cx <= 1; cx++)
      lowest = Math.min(
        lowest,
        rotatedPositionSum((x + cx) * TILE_UNITS, (y + cy) * TILE_UNITS, map, rotation),
      );
  return lowest;
}

function withinReach(x: number, y: number, tileX: number, tileY: number): boolean {
  const dx = Math.max(tileX - x / TILE_UNITS, x / TILE_UNITS - (tileX + 1), 0);
  const dy = Math.max(tileY - y / TILE_UNITS, y / TILE_UNITS - (tileY + 1), 0);
  return Math.max(dx, dy) <= SPRITE_REACH;
}
