const PATCH_WIDTH = 12;
const PATCH_HEIGHT = 20;
const MIN_ALPHA = 250;

export interface RgbaImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** How earth-like a pixel is: brown and red channels lead green, green leads blue. */
function earthiness(data: Uint8Array, offset: number): number {
  return data[offset]! - data[offset + 1]! + (data[offset + 1]! - data[offset + 2]!) * 0.5;
}

/**
 * Cuts the most earth-coloured fully opaque rectangle out of a cube-shaped terrain sprite so a
 * vertical cliff wall can be textured without the cube's transparent silhouette or grass top.
 */
export function earthWallPatch(source: RgbaImage): RgbaImage {
  let best = { x: -1, y: -1, score: -Infinity };
  for (let y = 0; y + PATCH_HEIGHT <= source.height; y++) {
    for (let x = 0; x + PATCH_WIDTH <= source.width; x++) {
      let score = 0;
      let opaque = true;
      for (let py = 0; py < PATCH_HEIGHT && opaque; py += 2)
        for (let px = 0; px < PATCH_WIDTH; px += 2) {
          const offset = ((y + py) * source.width + x + px) * 4;
          if (source.data[offset + 3]! < MIN_ALPHA) {
            opaque = false;
            break;
          }
          score += earthiness(source.data, offset);
        }
      if (opaque && score > best.score) best = { x, y, score };
    }
  }
  if (best.x < 0) throw new Error('Terrain sprite has no opaque earth region for a cliff wall');
  const data = new Uint8Array(PATCH_WIDTH * PATCH_HEIGHT * 4);
  for (let py = 0; py < PATCH_HEIGHT; py++)
    for (let px = 0; px < PATCH_WIDTH; px++) {
      const from = ((best.y + py) * source.width + best.x + px) * 4;
      data.set(source.data.subarray(from, from + 4), (py * PATCH_WIDTH + px) * 4);
    }
  return { data, width: PATCH_WIDTH, height: PATCH_HEIGHT };
}
