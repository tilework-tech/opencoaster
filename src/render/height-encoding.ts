/**
 * Baked sprite heights travel in RGBA8 depth pages: red and green hold a 16-bit height relative to
 * the sprite anchor, in steps of 1 / `HEIGHT_RESOLUTION` level, offset so negative heights fit;
 * alpha marks coverage. See src/render/docs.md ("Occlusion model").
 */
export const HEIGHT_RESOLUTION = 256;
const HEIGHT_OFFSET = 32768;

export function encodeHeight(levels: number): [number, number] {
  const value = Math.max(
    0,
    Math.min(65535, Math.round(levels * HEIGHT_RESOLUTION) + HEIGHT_OFFSET),
  );
  return [value >> 8, value & 255];
}

export function decodeHeight(hi: number, lo: number): number {
  return (hi * 256 + lo - HEIGHT_OFFSET) / HEIGHT_RESOLUTION;
}
