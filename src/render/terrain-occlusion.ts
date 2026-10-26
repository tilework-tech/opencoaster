import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { rotateTile, unrotateTile } from './projection';
import type { Rotation } from './projection';
import type { MapData } from './renderer';
import { SOLID_BIAS, rotatedPositionSum, terrainDepth } from './depth-key';

/** Sort offset of a raised tile redrawn over the sprites behind it. */
export const TERRAIN_OCCLUDER_DEPTH_OFFSET = 5;
/** Depth by which a sprite standing on a raised tile clears that tile's own redraw. */
const STANDING_CLEARANCE = 0.5;

type OcclusionMap = Pick<MapData, 'width' | 'height' | 'heights' | 'slope'>;

function peak(map: OcclusionMap, index: number): number {
  return map.heights[index]! + (map.slope[index] !== 0 ? 1 : 0);
}

/** True when the tile rises above either tile behind it in view space. */
export function tileRisesOverBehind(
  map: OcclusionMap,
  x: number,
  y: number,
  rotation: Rotation,
): boolean {
  const [rx, ry] = rotateTile(x, y, map.width, map.height, rotation);
  const here = peak(map, y * map.width + x);
  for (const [dx, dy] of [
    [-1, 0],
    [0, -1],
  ] as const) {
    const bx = rx + dx;
    const by = ry + dy;
    const viewWidth = rotation % 2 === 0 ? map.width : map.height;
    const viewHeight = rotation % 2 === 0 ? map.height : map.width;
    if (bx < 0 || by < 0 || bx >= viewWidth || by >= viewHeight) continue;
    const [wx, wy] = unrotateTile(bx, by, map.width, map.height, rotation);
    if (here > peak(map, wy * map.width + wx)) return true;
  }
  return false;
}

/** Sort depth of a tile's occluder redraw. */
export function occluderDepth(map: OcclusionMap, x: number, y: number, rotation: Rotation): number {
  return (
    terrainDepth(map, rotation, x, y, map.heights[y * map.width + x]!) +
    TERRAIN_OCCLUDER_DEPTH_OFFSET
  );
}

/**
 * Sort depth of an object standing at the centre of tile (x, y) at `groundZ`. On a tile that is
 * redrawn as an occluder the object sorts after that redraw, so the tile it stands on never
 * covers it; raised tiles in front of it still do.
 */
export function sceneryDepth(
  map: OcclusionMap,
  x: number,
  y: number,
  rotation: Rotation,
  groundZ: number,
  bias = SOLID_BIAS,
): number {
  const centre = rotatedPositionSum(
    x * TILE_UNITS + TILE_UNITS / 2,
    y * TILE_UNITS + TILE_UNITS / 2,
    map,
    rotation,
  );
  const depth = 2 * centre - groundZ / Z_STEP + bias;
  return tileRisesOverBehind(map, x, y, rotation)
    ? Math.max(depth, occluderDepth(map, x, y, rotation) + STANDING_CLEARANCE)
    : depth;
}
