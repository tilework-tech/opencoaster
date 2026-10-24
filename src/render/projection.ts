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
