import type { Prng } from '../core/prng';
import { relaxTerrain } from './land';
import { MAP_BORDER, OWNED, SALE_LAND, SALE_RIGHTS, Surface } from './tile-map';
import type { TileMap } from './tile-map';

const CELL = 8;
/** Water fills tiles whose lowest corner is below this level. */
export const SEA_LEVEL = 2;

/**
 * Deterministic rolling terrain: integer bilinear interpolation of a coarse random grid sampled
 * at tile corners, smoothed so no tile spans more than one level. The central half of the map
 * is owned, the rest (inside the border ring) is for sale.
 */
export function generateTerrain(map: TileMap, rng: Prng): void {
  const gw = Math.ceil(map.width / CELL) + 2;
  const gh = Math.ceil(map.height / CELL) + 2;
  const grid = new Uint8Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = 1 + rng.int(6);

  for (let vy = 0; vy <= map.height; vy++) {
    for (let vx = 0; vx <= map.width; vx++) {
      const gx = (vx / CELL) | 0;
      const gy = (vy / CELL) | 0;
      const fx = vx % CELL;
      const fy = vy % CELL;
      const a = grid[gy * gw + gx];
      const b = grid[gy * gw + gx + 1];
      const c = grid[(gy + 1) * gw + gx];
      const d = grid[(gy + 1) * gw + gx + 1];
      const top = a * (CELL - fx) + b * fx;
      const bottom = c * (CELL - fx) + d * fx;
      map.vertexHeights[map.vertexIndex(vx, vy)] =
        ((top * (CELL - fy) + bottom * fy) / (CELL * CELL)) | 0;
    }
  }
  relaxTerrain(map);

  const x0 = map.width >> 2;
  const x1 = map.width - x0;
  const y0 = map.height >> 2;
  const y1 = map.height - y0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = map.index(x, y);
      const h = map.heights[i];
      map.terrain[i] = Surface.Grass;
      map.waterLevel[i] = h < SEA_LEVEL ? SEA_LEVEL : 0;
      const border =
        x < MAP_BORDER ||
        y < MAP_BORDER ||
        x >= map.width - MAP_BORDER ||
        y >= map.height - MAP_BORDER;
      map.ownership[i] = border
        ? 0
        : x >= x0 && x < x1 && y >= y0 && y < y1
          ? OWNED
          : SALE_LAND | SALE_RIGHTS;
      map.refreshTile(i);
    }
  }
}
