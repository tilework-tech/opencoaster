import type { Prng } from '../core/prng';
import type { TileMap } from './tile-map';
import { Surface } from './tile-map';

const CELL = 8;

/** Deterministic rolling terrain: integer bilinear interpolation of a coarse random grid. */
export function generateTerrain(map: TileMap, rng: Prng): void {
  const gw = Math.ceil(map.width / CELL) + 2;
  const gh = Math.ceil(map.height / CELL) + 2;
  const grid = new Uint8Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = 1 + rng.int(6);

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const gx = (x / CELL) | 0;
      const gy = (y / CELL) | 0;
      const fx = x % CELL;
      const fy = y % CELL;
      const a = grid[gy * gw + gx];
      const b = grid[gy * gw + gx + 1];
      const c = grid[(gy + 1) * gw + gx];
      const d = grid[(gy + 1) * gw + gx + 1];
      const top = a * (CELL - fx) + b * fx;
      const bottom = c * (CELL - fx) + d * fx;
      const h = ((top * (CELL - fy) + bottom * fy) / (CELL * CELL)) | 0;
      const i = map.index(x, y);
      map.heights[i] = h;
      map.surface[i] = h <= 1 ? Surface.Water : h === 2 ? Surface.Sand : Surface.Grass;
    }
  }
}
