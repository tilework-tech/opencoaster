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
import { SceneryItem } from '../map/scenery';
import type {
  EntranceSide,
  ScenarioDef,
  ScenarioLand,
  ScenarioTerrain,
  ScenarioTrees,
  TerrainSurface,
  TreeSpecies,
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
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = map.index(x, y);
      const h = map.heights[i];
      map.terrain[i] = groundSurface(map, t, x, y);
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

/**
 * A tile is a steep face when a tile within `STEEP_REACH` rises or falls by `STEEP_RISE` levels:
 * the heights step at most one level per tile, so this is ground climbing at the steepest grade.
 */
const STEEP_REACH = 3;
const STEEP_RISE = 3;

/** The scenario's theme surface, with uplands and steep faces changed to rock or the highland surface. */
function groundSurface(map: TileMap, t: ScenarioTerrain, x: number, y: number): number {
  const h = map.heights[map.index(x, y)];
  if (t.highland && h >= t.highland.level) return SURFACES[t.highland.surface];
  if (isSteep(map, x, y)) return Surface.Rock;
  return SURFACES[t.surface];
}

function isSteep(map: TileMap, x: number, y: number): boolean {
  const h = map.heights[map.index(x, y)];
  for (let dy = -STEEP_REACH; dy <= STEEP_REACH; dy++) {
    for (let dx = -STEEP_REACH; dx <= STEEP_REACH; dx++) {
      if (!map.inBounds(x + dx, y + dy)) continue;
      if (Math.abs(map.heights[map.index(x + dx, y + dy)] - h) >= STEEP_RISE) return true;
    }
  }
  return false;
}

const TREE_RADIUS = 4;
const TREE_CLEARANCE = 3;
/** Clear ground kept free of scenery around the build apron, so the gate and first rides have room. */
const GATE_MARGIN = 2;
/** One tree in this many stands alone instead of joining a grove. */
const SOLITARY_EVERY = 6;

const SPECIES_ITEM: Record<TreeSpecies, SceneryItem> = {
  oak: SceneryItem.OakTree,
  conifer: SceneryItem.Conifer,
  birch: SceneryItem.BirchTree,
  blossom: SceneryItem.BlossomTree,
  autumn: SceneryItem.AutumnTree,
  topiary: SceneryItem.TopiaryTree,
  palm: SceneryItem.PalmTree,
  cactus: SceneryItem.CactusTree,
};

/** Species that grow on each ground surface, when the scenario does not list its own. */
const GROUND_SPECIES: Partial<Record<number, readonly TreeSpecies[]>> = {
  [Surface.Grass]: ['oak', 'birch', 'blossom', 'autumn', 'conifer', 'topiary'],
  [Surface.Dirt]: ['conifer'],
  [Surface.Sand]: ['palm', 'cactus'],
};

/**
 * Trees in groves of one species on dry, flat, owned or purchasable ground that suits them. Some
 * trees stand alone. Nothing goes on the build apron, the gate margin, water or rock.
 */
function scatterTrees(map: TileMap, trees: ScenarioTrees, apron: TileRect, rng: Prng): void {
  const pool = trees.species ?? [];
  const centres: Array<[number, number]> = [];
  for (let g = 0; g < trees.groves; g++) {
    centres.push([
      MAP_BORDER + rng.int(map.width - 2 * MAP_BORDER),
      MAP_BORDER + rng.int(map.height - 2 * MAP_BORDER),
    ]);
  }
  const grove = centres.map(() => null as TreeSpecies | null);
  let placed = 0;
  for (let attempt = 0; attempt < trees.count * 8 && placed < trees.count; attempt++) {
    const solitary = attempt % SOLITARY_EVERY === SOLITARY_EVERY - 1;
    const g = attempt % centres.length;
    const [cx, cy] = solitary
      ? [
          MAP_BORDER + rng.int(map.width - 2 * MAP_BORDER),
          MAP_BORDER + rng.int(map.height - 2 * MAP_BORDER),
        ]
      : centres[g];
    const x = solitary ? cx : cx + rng.int(2 * TREE_RADIUS + 1) - TREE_RADIUS;
    const y = solitary ? cy : cy + rng.int(2 * TREE_RADIUS + 1) - TREE_RADIUS;
    if (!map.inBounds(x, y)) continue;
    const i = map.index(x, y);
    if (nearApron(x, y, apron) || !isFreeGround(map, i)) continue;
    const allowed = (GROUND_SPECIES[map.terrain[i]] ?? []).filter(
      (s) => pool.length === 0 || pool.includes(s),
    );
    if (allowed.length === 0) continue;
    if (!solitary && grove[g] === null) grove[g] = allowed[rng.int(allowed.length)];
    const species =
      !solitary && grove[g] !== null && allowed.includes(grove[g]!)
        ? grove[g]!
        : allowed[rng.int(allowed.length)];
    const base = map.heights[i];
    if (
      map.addElement(
        i,
        ElementType.SmallScenery,
        base,
        base + TREE_CLEARANCE,
        0,
        SPECIES_ITEM[species],
      ) >= 0
    )
      placed++;
  }
}

function nearApron(x: number, y: number, apron: TileRect): boolean {
  return (
    x >= apron.x0 - GATE_MARGIN &&
    x <= apron.x1 + GATE_MARGIN &&
    y >= apron.y0 - GATE_MARGIN &&
    y <= apron.y1 + GATE_MARGIN
  );
}

function isFreeGround(map: TileMap, i: number): boolean {
  return (
    map.ownership[i] !== 0 &&
    map.waterLevel[i] === 0 &&
    map.slope[i] === 0 &&
    map.firstElement(i) < 0
  );
}
