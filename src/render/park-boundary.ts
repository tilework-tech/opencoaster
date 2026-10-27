import { OWNED, SALE_LAND, SALE_RIGHTS } from '../sim/map/tile-map';
import type { MapData } from './renderer';

/** Wall-style sprite name of the park boundary fence (see world-art.ts `wallSpriteName`). */
export const PARK_FENCE = 'park-fence';

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const cache = new WeakMap<MapData, Int32Array>();

/**
 * Edges of owned land that face land the park does not own (or the map border), as
 * `x, y, edge` triples with edge 0 = +x, 1 = +y, 2 = -x, 3 = -y. The park boundary fence stands
 * on each, drawn like wall scenery. Cached per map.
 */
export function parkBoundaryEdges(map: MapData): Int32Array {
  const cached = cache.get(map);
  if (cached) return cached;
  const out: number[] = [];
  const flags = map.ownership;
  if (flags)
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++) {
        if (!(flags[y * map.width + x]! & OWNED)) continue;
        for (let edge = 0; edge < 4; edge++) {
          const nx = x + DX[edge]!;
          const ny = y + DY[edge]!;
          const inside = nx >= 0 && ny >= 0 && nx < map.width && ny < map.height;
          if (inside && flags[ny * map.width + nx]! & OWNED) continue;
          out.push(x, y, edge);
        }
      }
  const edges = Int32Array.from(out);
  cache.set(map, edges);
  return edges;
}

/** What the land overlay draws on one tile of land the park does not own. */
export interface LandOverlayTile {
  x: number;
  y: number;
  /** 0 not offered, SALE_LAND, SALE_RIGHTS, or 3 for both. */
  sale: number;
  /** World edges (bit 0 = +x, 1 = +y, 2 = -x, 3 = -y) carrying a sale border. */
  borders: number;
}

const overlayCache = new WeakMap<MapData, LandOverlayTile[]>();

function saleType(ownership: number): number {
  const land = (ownership & SALE_LAND) !== 0;
  const rights = (ownership & SALE_RIGHTS) !== 0;
  return land && rights ? 3 : land ? SALE_LAND : rights ? SALE_RIGHTS : 0;
}

/**
 * Every tile the park does not own, with its sale offer and the edges where that offer's border
 * runs: an edge is bordered unless the neighbour has the same offer, or a weaker one that draws
 * the shared border itself. Cached per map.
 */
export function landOverlayTiles(map: MapData): LandOverlayTile[] {
  const cached = overlayCache.get(map);
  if (cached) return cached;
  const out: LandOverlayTile[] = [];
  const flags = map.ownership;
  if (flags)
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++) {
        const ownership = flags[y * map.width + x]!;
        if (ownership & OWNED) continue;
        const sale = saleType(ownership);
        let borders = 0;
        if (sale !== 0)
          for (let edge = 0; edge < 4; edge++) {
            const nx = x + DX[edge]!;
            const ny = y + DY[edge]!;
            const inside = nx >= 0 && ny >= 0 && nx < map.width && ny < map.height;
            const neighbour = inside ? saleType(flags[ny * map.width + nx]!) : 0;
            if (neighbour === sale || (neighbour !== 0 && neighbour < sale)) continue;
            borders |= 1 << edge;
          }
        out.push({ x, y, sale, borders });
      }
  overlayCache.set(map, out);
  return out;
}
