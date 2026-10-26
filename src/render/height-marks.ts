import { worldToScreen } from './projection';
import type { Rotation } from './projection';

export type HeightMarkKind = 'land' | 'path' | 'water';

/** One height number to draw, in viewport-local pixels, centred on `x`, `y`. */
export interface HeightMark {
  x: number;
  y: number;
  text: string;
  kind: HeightMarkKind;
}

export interface HeightMarkMap {
  width: number;
  height: number;
  heights: Uint8Array;
  slope: Uint8Array;
  waterLevel?: Uint8Array;
  /** Path elements, six ints each: x, y, level, flags, then two unused here. */
  pathElements?: Int32Array;
  pathCount?: number;
}

const PATH_STRIDE = 6;
const EDGE_MARGIN = 14;

/** Tiles between labelled tiles: every tile at default zoom or closer, sparser when zoomed out. */
export function heightMarkStep(zoom: number): number {
  return zoom >= 1 ? 1 : 2;
}

/** Bit count of a corner slope mask: the tile's mean surface height above its base level. */
function maskRise(mask: number): number {
  return ((mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1)) / 4;
}

/**
 * The height numbers to draw for the tiles on screen. Land shows its base level at the centre of
 * its surface; water shows the water level at the surface; a footpath shows its own level at the
 * path and replaces the land number beneath it.
 */
export function heightMarkPlacements(
  map: HeightMarkMap,
  camera: { x: number; y: number; zoom: number; rotation: Rotation },
  viewport: { width: number; height: number },
): HeightMark[] {
  const step = heightMarkStep(camera.zoom);
  const marks: HeightMark[] = [];
  const pathLevels = new Map<number, number>();
  for (let i = 0; map.pathElements && i < (map.pathCount ?? 0); i++) {
    const offset = i * PATH_STRIDE;
    const tile = map.pathElements[offset + 1]! * map.width + map.pathElements[offset]!;
    const level = map.pathElements[offset + 2]!;
    if (!pathLevels.has(tile) || level < pathLevels.get(tile)!) pathLevels.set(tile, level);
  }
  const place = (x: number, y: number, z: number, text: string, kind: HeightMarkKind): void => {
    const [wx, wy] = worldToScreen(x + 0.5, y + 0.5, z, camera.rotation, map);
    const sx = viewport.width / 2 + (wx - camera.x) * camera.zoom;
    const sy = viewport.height / 2 + (wy - camera.y) * camera.zoom;
    if (sx < -EDGE_MARGIN || sy < -EDGE_MARGIN) return;
    if (sx > viewport.width + EDGE_MARGIN || sy > viewport.height + EDGE_MARGIN) return;
    marks.push({ x: sx, y: sy, text, kind });
  };
  for (let y = 0; y < map.height; y += step) {
    for (let x = 0; x < map.width; x += step) {
      const tile = y * map.width + x;
      const base = map.heights[tile]!;
      const path = pathLevels.get(tile);
      if (path !== undefined) {
        place(x, y, path, String(path), 'path');
        continue;
      }
      const water = map.waterLevel?.[tile] ?? 0;
      if (water > base) place(x, y, water, String(water), 'water');
      else place(x, y, base + maskRise(map.slope[tile]!), String(base), 'land');
    }
  }
  return marks;
}
