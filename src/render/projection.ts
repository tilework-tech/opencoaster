import { TILE_UNITS, Z_STEP } from '../sim/core/constants';

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

/** Returns the highest tile diamond under a viewport-local point, or null outside the map. */
export function pickTile(
  screenX: number,
  screenY: number,
  map: { width: number; height: number; heights: Uint8Array },
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
  let selectedDistance = Number.POSITIVE_INFINITY;
  let selectedHeight = -1;

  // Elevation can shift the projected tile by at most half the 31-level map range.
  for (let ry = estimatedRy - 16; ry <= estimatedRy + 16; ry++) {
    for (let rx = estimatedRx - 16; rx <= estimatedRx + 16; rx++) {
      if (rx < 0 || ry < 0 || rx >= viewW || ry >= viewH) continue;
      const [x, y] = unrotateTile(rx, ry, map.width, map.height, camera.rotation);
      const height = map.heights[y * map.width + x];
      const centerX = (rx - ry) * (TILE_W / 2);
      const centerY = (rx + ry) * (TILE_H / 2) + TILE_H / 2 - height * Z_PIXELS;
      const dx = Math.abs(worldX - centerX) / (TILE_W / 2);
      const dy = Math.abs(worldY - centerY) / (TILE_H / 2);
      const distance = dx + dy;
      if (distance > 1 || distance > selectedDistance) continue;
      if (distance === selectedDistance && height < selectedHeight) continue;
      selected = [x, y];
      selectedDistance = distance;
      selectedHeight = height;
    }
  }

  return selected;
}
