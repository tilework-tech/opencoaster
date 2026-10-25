import { waterColor } from '../palette';
import { hash2 } from '../noise';
import type { Sprite } from '../raster';

export const WATER_FRAMES = 8;

/**
 * Ripple slot (0-7) of a water texel at cell (i, j) of the periodic 32x32 tile texture. Crests run
 * along lines of constant i + j (screen-horizontal in the dimetric view) and are broken into
 * dashes by a hash of the cell along i - j; the shimmer is this slot advancing through the cycle.
 */
export function waterSlot(i: number, j: number): number {
  const band = (i + j) >> 2;
  const dash = ((((i - j) % 32) + 32) % 32) >> 3;
  const jitter = Math.floor(hash2(dash, band & 7, 21) * 2);
  return (band + jitter) & 7;
}

export const WATER_TEXTURE_SIZE = 32;

/**
 * Square tile-space water texture (u along +x, v along +y of the tile) for the terrain mesh
 * renderer; periodic so neighbouring tiles join seamlessly. Frames differ only by palette cycle.
 */
export function waterTexture(frame: number): Sprite {
  const size = WATER_TEXTURE_SIZE;
  const pixels = new Uint8Array(size * size);
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) pixels[j * size + i] = waterColor(waterSlot(i, j), frame);
  return { width: size, height: size, anchor: { x: 0, y: 0 }, pixels };
}
