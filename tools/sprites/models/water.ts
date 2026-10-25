import { waterColor } from '../palette';
import type { Sprite } from '../raster';

export const WATER_FRAMES = 8;

/**
 * Ripple shade (0-2) at a texel. Broad, low-amplitude waves avoid a checker pattern at close zoom;
 * the palette frame advances these neighboring shades to give the surface a gentle shimmer.
 */
export function waterSlot(i: number, j: number): number {
  const wave = Math.sin((i + j) * 0.2 + Math.sin((i - j) * 0.13) * 1.2);
  return Math.max(0, Math.min(2, Math.round(1 + wave)));
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
