import { waterColor } from '../palette';
import { hash2 } from '../noise';
import type { Sprite } from '../raster';

export const WATER_FRAMES = 8;

/** Ripple slot (0-7) of a water pixel; the shimmer is this slot advancing through the palette cycle. */
export function waterSlot(x: number, y: number): number {
  const i = Math.floor((x + 0.5) * 32);
  const j = Math.floor((y + 0.5) * 32);
  const wave = (i + 2 * j) & 7;
  const jitter = Math.floor(hash2(i >> 1, j >> 1, 21) * 3);
  return (wave + jitter) & 7;
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
    for (let i = 0; i < size; i++)
      pixels[j * size + i] = waterColor(
        waterSlot((i + 0.5) / size - 0.5, (j + 0.5) / size - 0.5),
        frame,
      );
  return { width: size, height: size, anchor: { x: 0, y: 0 }, pixels };
}
