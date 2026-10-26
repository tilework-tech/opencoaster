import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { viewDepth } from './projection';
import type { Rotation } from './projection';

/**
 * Draw-order key shared by both renderers: `2 * (x + y)` in rotated tile units minus the height
 * in levels, taken at an object's ground pivot. Larger keys are drawn later.
 *
 * The key does not decide occlusion: both renderers order every world surface per pixel by its
 * world height (docs.md, "Occlusion model"). It only orders the translucent pass (water, patrol
 * overlays, placement previews) back to front and settles exact height ties, so it carries no
 * per-object bias.
 */
export function anchorKey(
  map: { width: number; height: number },
  rotation: Rotation,
  x: number,
  y: number,
  z: number,
): number {
  return 2 * rotatedPositionSum(x, y, map, rotation) - z / Z_STEP;
}

/** Rotated `x + y` of a world-unit position: larger is nearer the camera. */
export function rotatedPositionSum(
  x: number,
  y: number,
  map: { width: number; height: number },
  rotation: Rotation,
): number {
  return viewDepth(x / TILE_UNITS, y / TILE_UNITS, rotation, map);
}
