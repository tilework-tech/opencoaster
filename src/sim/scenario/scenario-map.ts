import { Prng } from '../core/prng';
import { relaxTerrain } from '../map/land';
import {
  ElementType,
  MAP_BORDER,
  MAX_HEIGHT,
  OWNED,
  SALE_LAND,
  SALE_RIGHTS,
  Surface,
} from '../map/tile-map';
import type { TileMap } from '../map/tile-map';
import type {
  EntranceSide,
  ScenarioDef,
  ScenarioLand,
  ScenarioTerrain,
  ScenarioTrees,
  TerrainSurface,
} from './scenario';

const SURFACES: Record<TerrainSurface, number> = {
  grass: Surface.Grass,
  sand: Surface.Sand,
  dirt: Surface.Dirt,
  rock: Surface.Rock,
};

export const DEFAULT_LAND: ScenarioLand = { ownedMarginPercent: 25, saleMarginPercent: 0 };

/** Inclusive tile rectangle. */
export interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The land the player owns at the start: an inset rectangle of the map. */
export function ownedBounds(
  width: number,
  height: number,
  land: ScenarioLand = DEFAULT_LAND,
): TileRect {
  const mx = Math.floor((width * land.ownedMarginPercent) / 100);
  const my = Math.floor((height * land.ownedMarginPercent) / 100);
  return { x0: mx, y0: my, x1: width - mx - 1, y1: height - my - 1 };
}

/** The flat apron in front of the gate: `buildLength` tiles inward and `buildWidth` across, centred on the gate edge. */
export function buildApron(
  width: number,
  height: number,
  side: EntranceSide,
  terrain: Pick<ScenarioTerrain, 'buildLength' | 'buildWidth'>,
  land: ScenarioLand = DEFAULT_LAND,
): TileRect {
  const o = ownedBounds(width, height, land);
  const half = terrain.buildWidth >> 1;
  const midX = (o.x0 + o.x1) >> 1;
  const midY = (o.y0 + o.y1) >> 1;
  switch (side) {
    case 'south':
      return {
        x0: midX - half,
        x1: midX - half + terrain.buildWidth - 1,
        y1: o.y1,
        y0: o.y1 - terrain.buildLength + 1,
      };
    case 'north':
      return {
        x0: midX - half,
        x1: midX - half + terrain.buildWidth - 1,
        y0: o.y0,
        y1: o.y0 + terrain.buildLength - 1,
      };
    case 'east':
      return {
        y0: midY - half,
        y1: midY - half + terrain.buildWidth - 1,
        x1: o.x1,
        x0: o.x1 - terrain.buildLength + 1,
      };
    case 'west':
      return {
        y0: midY - half,
        y1: midY - half + terrain.buildWidth - 1,
        x0: o.x0,
        x1: o.x0 + terrain.buildLength - 1,
      };
  }
}

/**
 * Replaces the default terrain with the scenario's recipe: coarse noise, hills and lakes, a flat
 * dry apron in front of the gate, land ownership and sale rules, then trees. The result depends
 * only on `seed` and the recipe.
 */
export function generateScenarioMap(map: TileMap, def: ScenarioDef, seed: number): void {
  const terrain = def.terrain;
  if (!terrain) return;
  const land = def.land ?? DEFAULT_LAND;
  const side = def.entrance?.side ?? 'south';
  const apron = buildApron(map.width, map.height, side, terrain, land);
  const rng = new Prng(seed ^ 0x7e44a1);

  shapeHeights(map, terrain, apron, rng);
  relaxTerrain(map);
  paintTiles(map, terrain, land);
  if (def.trees) scatterTrees(map, def.trees, apron, rng);
}

function shapeHeights(map: TileMap, t: ScenarioTerrain, apron: TileRect, rng: Prng): void {
  const gw = Math.ceil(map.width / t.cell) + 2;
  const gh = Math.ceil(map.height / t.cell) + 2;
  const grid = new Uint8Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.int(t.relief + 1);
  const floor = t.baseLevel - (t.relief >> 1);

  for (let vy = 0; vy <= map.height; vy++) {
    for (let vx = 0; vx <= map.width; vx++) {
      const gx = Math.floor(vx / t.cell);
      const gy = Math.floor(vy / t.cell);
      const fx = vx % t.cell;
      const fy = vy % t.cell;
      const top = grid[gy * gw + gx] * (t.cell - fx) + grid[gy * gw + gx + 1] * fx;
      const bottom = grid[(gy + 1) * gw + gx] * (t.cell - fx) + grid[(gy + 1) * gw + gx + 1] * fx;
      let h = floor + Math.floor((top * (t.cell - fy) + bottom * fy) / (t.cell * t.cell));

      for (const hill of t.hills) {
        const dx = vx - Math.floor((hill.x * map.width) / 100);
        const dy = vy - Math.floor((hill.y * map.height) / 100);
        const r2 = hill.radius * hill.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 < r2) h += 1 + Math.floor((hill.height * (r2 - d2)) / r2);
      }
      for (const lake of t.lakes) {
        const dx = vx - Math.floor((lake.x * map.width) / 100);
        const dy = vy - Math.floor((lake.y * map.height) / 100);
        const rx2 = lake.rx * lake.rx;
        const ry2 = lake.ry * lake.ry;
        const d2 = dx * dx * ry2 + dy * dy * rx2;
        if (d2 < rx2 * ry2) {
          const dip = 1 + Math.floor((lake.depth * (rx2 * ry2 - d2)) / (rx2 * ry2));
          h = Math.min(h, t.seaLevel - dip);
        }
      }

      const gap = Math.max(
        apron.x0 - vx,
        vx - (apron.x1 + 1),
        apron.y0 - vy,
        vy - (apron.y1 + 1),
        0,
      );
      if (gap === 0) h = t.buildLevel;
      else h = Math.min(Math.max(h, t.buildLevel - gap), t.buildLevel + gap);
      map.vertexHeights[map.vertexIndex(vx, vy)] = Math.max(0, Math.min(MAX_HEIGHT, h));
    }
  }
}

function paintTiles(map: TileMap, t: ScenarioTerrain, land: ScenarioLand): void {
  const owned = ownedBounds(map.width, map.height, land);
  const saleX = Math.floor((map.width * land.saleMarginPercent) / 100);
  const saleY = Math.floor((map.height * land.saleMarginPercent) / 100);
  const base = SURFACES[t.surface];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = map.index(x, y);
      const h = map.heights[i];
      map.terrain[i] = h <= t.seaLevel ? Surface.Sand : base;
      map.waterLevel[i] = h < t.seaLevel ? t.seaLevel : 0;
      const border =
        x < MAP_BORDER ||
        y < MAP_BORDER ||
        x >= map.width - MAP_BORDER ||
        y >= map.height - MAP_BORDER;
      const inOwned = x >= owned.x0 && x <= owned.x1 && y >= owned.y0 && y <= owned.y1;
      const unsellable =
        x < saleX || y < saleY || x >= map.width - saleX || y >= map.height - saleY;
      map.ownership[i] = border ? 0 : inOwned ? OWNED : unsellable ? 0 : SALE_LAND | SALE_RIGHTS;
      map.refreshTile(i);
    }
  }
}

const TREE_RADIUS = 4;
const TREE_CLEARANCE = 3;

/** Small-scenery trees in clumps on dry, flat, owned or purchasable ground, never on the apron. */
function scatterTrees(map: TileMap, trees: ScenarioTrees, apron: TileRect, rng: Prng): void {
  const centres: Array<[number, number]> = [];
  for (let g = 0; g < trees.groves; g++) {
    centres.push([
      MAP_BORDER + rng.int(map.width - 2 * MAP_BORDER),
      MAP_BORDER + rng.int(map.height - 2 * MAP_BORDER),
    ]);
  }
  let placed = 0;
  for (let attempt = 0; attempt < trees.count * 8 && placed < trees.count; attempt++) {
    const [cx, cy] = centres[attempt % centres.length];
    const x = cx + rng.int(2 * TREE_RADIUS + 1) - TREE_RADIUS;
    const y = cy + rng.int(2 * TREE_RADIUS + 1) - TREE_RADIUS;
    if (!map.inBounds(x, y)) continue;
    const i = map.index(x, y);
    const onApron =
      x >= apron.x0 - 1 && x <= apron.x1 + 1 && y >= apron.y0 - 1 && y <= apron.y1 + 1;
    if (onApron || map.ownership[i] === 0 || map.waterLevel[i] !== 0 || map.slope[i] !== 0)
      continue;
    if (map.terrain[i] !== Surface.Grass || map.firstElement(i) >= 0) continue;
    const base = map.heights[i];
    if (map.addElement(i, ElementType.SmallScenery, base, base + TREE_CLEARANCE, 0, 0) >= 0)
      placed++;
  }
}
