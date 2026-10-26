import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { terrainMeshTriangles, terrainTileCorners } from './terrain-geometry';

export type Rotation = 0 | 1 | 2 | 3;

export const TILE_W = 64;
export const TILE_H = 32;
/** Screen pixels per height level. */
export const Z_PIXELS = 16;

/** Rotates a tile coordinate into view space for the given quarter-turn count. */
export function rotateTile(
  x: number,
  y: number,
  w: number,
  h: number,
  rot: Rotation,
): [number, number] {
  switch (rot) {
    case 0:
      return [x, y];
    case 1:
      return [h - 1 - y, x];
    case 2:
      return [w - 1 - x, h - 1 - y];
    case 3:
      return [y, w - 1 - x];
  }
}

export function unrotateTile(
  rx: number,
  ry: number,
  w: number,
  h: number,
  rot: Rotation,
): [number, number] {
  switch (rot) {
    case 0:
      return [rx, ry];
    case 1:
      return [ry, h - 1 - rx];
    case 2:
      return [w - 1 - rx, h - 1 - ry];
    case 3:
      return [w - 1 - ry, rx];
  }
}

/** Rotated view-space dimensions. */
export function viewSize(w: number, h: number, rot: Rotation): [number, number] {
  return rot % 2 === 0 ? [w, h] : [h, w];
}

/**
 * Projects a fixed-point world position (TILE_UNITS per tile, Z_STEP per level) to screen
 * pixels relative to the map origin. Continuous: usable for entities between tiles.
 */
export function project(
  fx: number,
  fy: number,
  fz: number,
  w: number,
  h: number,
  rot: Rotation,
  out: Float64Array,
): void {
  const tx = fx / TILE_UNITS;
  const ty = fy / TILE_UNITS;
  // Continuous rotation about the map: tile-centre convention matches rotateTile.
  let rx: number;
  let ry: number;
  switch (rot) {
    case 0:
      rx = tx;
      ry = ty;
      break;
    case 1:
      rx = h - ty;
      ry = tx;
      break;
    case 2:
      rx = w - tx;
      ry = h - ty;
      break;
    default:
      rx = ty;
      ry = w - tx;
      break;
  }
  out[0] = (rx - ry) * (TILE_W / 2);
  out[1] = (rx + ry) * (TILE_H / 2) - (fz / Z_STEP) * Z_PIXELS;
}

/** Returns the last terrain surface under a viewport-local point in painter order. */
export function pickTile(
  screenX: number,
  screenY: number,
  map: { width: number; height: number; heights: Uint8Array; slope?: Uint8Array },
  camera: { x: number; y: number; zoom: number; rotation: Rotation },
  viewport: { width: number; height: number },
): [number, number] | null {
  if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) return null;

  const worldX = camera.x + (screenX - viewport.width / 2) / camera.zoom;
  const worldY = camera.y + (screenY - viewport.height / 2) / camera.zoom;
  const axisX = worldX / (TILE_W / 2);
  const axisY = worldY / (TILE_H / 2) - 1;
  const centerRx = (axisX + axisY) / 2;
  const centerRy = (axisY - axisX) / 2;
  const [viewW, viewH] = viewSize(map.width, map.height, camera.rotation);
  const estimatedRx = Math.round(centerRx);
  const estimatedRy = Math.round(centerRy);
  let selected: [number, number] | null = null;
  let selectedDepth = Number.NEGATIVE_INFINITY;
  const projected = [
    new Float64Array(2),
    new Float64Array(2),
    new Float64Array(2),
    new Float64Array(2),
  ];

  // Elevation can shift the projected tile by at most half the 31-level map range.
  for (let ry = estimatedRy - 16; ry <= estimatedRy + 16; ry++) {
    for (let rx = estimatedRx - 16; rx <= estimatedRx + 16; rx++) {
      if (rx < 0 || ry < 0 || rx >= viewW || ry >= viewH) continue;
      const [x, y] = unrotateTile(rx, ry, map.width, map.height, camera.rotation);
      const index = y * map.width + x;
      const corners = terrainTileCorners(x, y, map.heights[index]!, map.slope?.[index] ?? 0);
      for (let corner = 0; corner < 4; corner++)
        project(
          corners[corner]!.x * TILE_UNITS,
          corners[corner]!.y * TILE_UNITS,
          corners[corner]!.height * Z_STEP,
          map.width,
          map.height,
          camera.rotation,
          projected[corner]!,
        );
      const triangles = terrainMeshTriangles(camera.rotation);
      for (const triangle of triangles) {
        const a = projected[triangle[0]]!;
        const b = projected[triangle[1]]!;
        const c = projected[triangle[2]]!;
        const ax = viewport.width / 2 + (a[0]! - camera.x) * camera.zoom;
        const ay = viewport.height / 2 + (a[1]! - camera.y) * camera.zoom;
        const bx = viewport.width / 2 + (b[0]! - camera.x) * camera.zoom;
        const by = viewport.height / 2 + (b[1]! - camera.y) * camera.zoom;
        const cx = viewport.width / 2 + (c[0]! - camera.x) * camera.zoom;
        const cy = viewport.height / 2 + (c[1]! - camera.y) * camera.zoom;
        const weights = barycentric(screenX, screenY, ax, ay, bx, by, cx, cy);
        if (!weights || weights.some((weight) => weight < -1e-7)) continue;
        const depth = 2 * (rx + ry) - map.heights[index]!;
        if (depth < selectedDepth) continue;
        selected = [x, y];
        selectedDepth = depth;
      }
    }
  }

  return selected;
}

function barycentric(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): [number, number, number] | null {
  const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(denominator) < 1e-9) return null;
  const a = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denominator;
  const b = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denominator;
  return [a, b, 1 - a - b];
}
