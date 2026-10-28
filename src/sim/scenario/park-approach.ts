import type { World } from '../core/world';
import { addPeepSpawn } from '../guests/park';
import { placePathOutcome, PathResult } from '../map/paths';
import { ElementType, OWNED } from '../map/tile-map';
import type { TileMap } from '../map/tile-map';
import type { EntranceSide } from './scenario';

/** Step from the gate into the park for each side's entrance. */
export const INWARD: Record<EntranceSide, readonly [number, number]> = {
  north: [0, 1],
  south: [0, -1],
  east: [-1, 0],
  west: [1, 0],
};

const MAX_RELAX_PASSES = 512;

/**
 * Makes every tile in `tiles` flat and dry at `level`, then lowers or raises the surrounding
 * vertices just enough that no tile spans more than one level. Scenery on the tiles and on every tile whose
 * corners moved is cleared, since it was placed against the old ground.
 */
export function levelTiles(
  m: TileMap,
  tiles: ReadonlyArray<readonly [number, number]>,
  level: number,
): void {
  const w1 = m.width + 1;
  const h1 = m.height + 1;
  const vh = m.vertexHeights;
  const before = vh.slice();
  const pinned = new Uint8Array(vh.length);
  for (const [x, y] of tiles) {
    for (const [vx, vy] of [
      [x, y],
      [x + 1, y],
      [x, y + 1],
      [x + 1, y + 1],
    ] as const) {
      vh[vy * w1 + vx] = level;
      pinned[vy * w1 + vx] = 1;
    }
  }
  for (let pass = 0; pass < MAX_RELAX_PASSES; pass++) {
    let changed = false;
    for (let vy = 0; vy < h1; vy++) {
      for (let vx = 0; vx < w1; vx++) {
        const v = vy * w1 + vx;
        if (pinned[v]) continue;
        let lo = 0;
        let hi = 255;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = vx + dx;
            const ny = vy + dy;
            if (nx < 0 || ny < 0 || nx >= w1 || ny >= h1 || (dx === 0 && dy === 0)) continue;
            const n = vh[ny * w1 + nx]!;
            if (n - 1 > lo) lo = n - 1;
            if (n + 1 < hi) hi = n + 1;
          }
        }
        const next = Math.min(Math.max(vh[v]!, lo), Math.max(lo, hi));
        if (next !== vh[v]) {
          vh[v] = next;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      const o = y * w1 + x;
      const moved =
        vh[o] !== before[o] ||
        vh[o + 1] !== before[o + 1] ||
        vh[o + w1] !== before[o + w1] ||
        vh[o + w1 + 1] !== before[o + w1 + 1];
      if (!moved) continue;
      const i = m.index(x, y);
      clearScenery(m, i);
      m.refreshTile(i);
      if (m.waterLevel[i]! > 0 && m.heights[i]! >= m.waterLevel[i]!) m.waterLevel[i] = 0;
    }
  }
  for (const [x, y] of tiles) {
    const i = m.index(x, y);
    clearScenery(m, i);
    m.waterLevel[i] = 0;
  }
}

function clearScenery(m: TileMap, i: number): void {
  for (let e = m.firstElement(i); e >= 0;) {
    const next = m.nextElement(e);
    if (m.elType[e] === ElementType.SmallScenery) m.removeElement(i, e);
    e = next;
  }
}

/** Places a footpath on a tile the player does not own, which ordinary placement refuses. */
function placeUnownedPath(m: TileMap, x: number, y: number): boolean {
  const i = m.index(x, y);
  const owner = m.ownership[i]!;
  m.ownership[i] = owner | OWNED;
  const result = placePathOutcome(m, { x, y });
  m.ownership[i] = owner;
  return result === PathResult.Ok;
}

/**
 * Runs a footpath from the gate at (gx, gy) outward across any unowned land to the map edge and
 * puts a peep spawn point on the last tile, the way RCT2 parks join their entrance to the edge.
 * The strip is levelled to the gate's height. Returns the number of path pieces placed, or 0 when
 * the strip cannot be built.
 */
export function layOutApproach(world: World, side: EntranceSide, gx: number, gy: number): number {
  const m = world.map;
  const [dx, dy] = INWARD[side];
  const tiles: Array<[number, number]> = [];
  for (let x = gx - dx, y = gy - dy; m.inBounds(x, y); x -= dx, y -= dy) tiles.push([x, y]);
  if (tiles.length === 0) return 0;
  levelTiles(m, tiles, m.heights[m.index(gx, gy)]!);
  let placed = 0;
  for (const [x, y] of tiles) {
    if (!placeUnownedPath(m, x, y)) return placed;
    placed++;
  }
  const [ex, ey] = tiles[tiles.length - 1]!;
  addPeepSpawn(world, ex, ey);
  return placed;
}
