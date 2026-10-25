import type { World } from '../core/world';
import { LedgerCategory, post } from '../economy/ledger';
import {
  landEditCostCents,
  lowerLand,
  paintLand,
  raiseLand,
  setTileHeight,
  setWaterLevel,
} from './land';
import { placePath, removePath, setPathAddition, type PathAddition } from './paths';
import {
  LAND_SURFACE_COST_CENTS,
  LAND_PRICE_CENTS,
  OWNED,
  PATH_COST_CENTS,
  RIGHTS_OWNED,
  RIGHTS_PRICE_CENTS,
  WATER_TILE_ACTION_COST_CENTS,
  SALE_LAND,
  SALE_RIGHTS,
} from './tile-map';
import type { TileMap } from './tile-map';
import { TILE_UNITS } from '../core/constants';

/** Map-owned player commands; the core `Command` union includes this type. */
export type MapCommand =
  | { type: 'setTileHeight'; x: number; y: number; height: number }
  | { type: 'raiseLand'; x: number; y: number; width: number; height: number; corner?: number }
  | { type: 'lowerLand'; x: number; y: number; width: number; height: number; corner?: number }
  | { type: 'setWater'; x: number; y: number; width: number; height: number; level: number }
  | { type: 'paintLand'; x: number; y: number; width: number; height: number; surface: number }
  | { type: 'placePath'; x: number; y: number; z?: number; slope?: number; queue?: boolean }
  | { type: 'removePath'; x: number; y: number; z?: number }
  | { type: 'setPathAddition'; x: number; y: number; addition: PathAddition }
  | { type: 'buyLand'; x: number; y: number; width: number; height: number; rights: boolean };

function canAfford(w: World, cents: number): boolean {
  return w.economy.cash >= cents;
}

function charge(w: World, category: LedgerCategory, cents: number): void {
  post(w.economy, category, -cents);
}

/** Tiles in the rectangle that the purchase would acquire. */
function buyable(m: TileMap, x: number, y: number, w: number, h: number, rights: boolean): number {
  const sale = rights ? SALE_RIGHTS : SALE_LAND;
  const have = rights ? OWNED | RIGHTS_OWNED : OWNED;
  let n = 0;
  for (let ty = Math.max(0, y); ty < Math.min(m.height, y + h); ty++) {
    for (let tx = Math.max(0, x); tx < Math.min(m.width, x + w); tx++) {
      const o = m.ownership[m.index(tx, ty)];
      if (o & sale && !(o & have)) n++;
    }
  }
  return n;
}

function applyBuy(m: TileMap, x: number, y: number, w: number, h: number, rights: boolean): void {
  const sale = rights ? SALE_RIGHTS : SALE_LAND;
  const have = rights ? OWNED | RIGHTS_OWNED : OWNED;
  for (let ty = Math.max(0, y); ty < Math.min(m.height, y + h); ty++) {
    for (let tx = Math.max(0, x); tx < Math.min(m.width, x + w); tx++) {
      const i = m.index(tx, ty);
      const o = m.ownership[i];
      if (o & sale && !(o & have)) m.ownership[i] = (o & ~sale) | (rights ? RIGHTS_OWNED : OWNED);
    }
  }
  m.revision++;
}

function affectedTerrainTiles(
  m: TileMap,
  x: number,
  y: number,
  width: number,
  height: number,
  up: boolean,
  corner?: number,
): Uint8Array {
  const affected = new Uint8Array(m.width * m.height);
  if (width < 1 || height < 1 || !m.inBounds(x, y) || !m.inBounds(x + width - 1, y + height - 1))
    return affected;
  if (corner !== undefined) {
    affected[m.index(x, y)] = 1;
    return affected;
  }
  let extreme = up ? 31 : 0;
  for (let ty = y; ty < y + height; ty++)
    for (let tx = x; tx < x + width; tx++) {
      const index = m.index(tx, ty);
      const level = m.heights[index] + (!up && m.slope[index] !== 0 ? 1 : 0);
      extreme = up ? Math.min(extreme, level) : Math.max(extreme, level);
    }
  for (let ty = y; ty < y + height; ty++)
    for (let tx = x; tx < x + width; tx++) {
      const index = m.index(tx, ty);
      const level = m.heights[index] + (!up && m.slope[index] !== 0 ? 1 : 0);
      if (level === extreme) affected[index] = 1;
    }
  return affected;
}

function removeLitterOnTerrainTiles(w: World, affected: Uint8Array): void {
  for (let slot = w.litter.count - 1; slot >= 0; slot--) {
    const x = (w.litter.cols.x[slot] / TILE_UNITS) | 0;
    const y = (w.litter.cols.y[slot] / TILE_UNITS) | 0;
    if (w.map.inBounds(x, y) && affected[w.map.index(x, y)]) w.litter.despawnSlot(slot);
  }
}

/** Applies one map command to the world; invalid or unaffordable commands are ignored. */
export function applyMapCommand(w: World, c: MapCommand): void {
  const m = w.map;
  switch (c.type) {
    case 'setTileHeight':
      setTileHeight(m, c.x | 0, c.y | 0, c.height | 0);
      break;
    case 'raiseLand':
    case 'lowerLand': {
      const x = c.x | 0;
      const y = c.y | 0;
      const width = c.width | 0;
      const height = c.height | 0;
      const corner = c.corner === undefined ? undefined : c.corner | 0;
      const cost = landEditCostCents(m, x, y, width, height, c.type === 'raiseLand', corner);
      if (!canAfford(w, cost)) break;
      const affected = affectedTerrainTiles(m, x, y, width, height, c.type === 'raiseLand', corner);
      const edit = c.type === 'raiseLand' ? raiseLand : lowerLand;
      if (edit(m, x, y, width, height, corner)) {
        charge(w, LedgerCategory.Landscaping, cost);
        removeLitterOnTerrainTiles(w, affected);
      }
      break;
    }
    case 'setWater': {
      const x = c.x | 0;
      const y = c.y | 0;
      const width = c.width | 0;
      const height = c.height | 0;
      const level = c.level | 0;
      let changed = 0;
      if (
        width > 0 &&
        height > 0 &&
        m.inBounds(x, y) &&
        m.inBounds(x + width - 1, y + height - 1)
      ) {
        const boundedLevel = Math.max(0, Math.min(31, level));
        for (let ty = y; ty < y + height; ty++)
          for (let tx = x; tx < x + width; tx++)
            if (m.waterLevel[m.index(tx, ty)] !== boundedLevel) changed++;
      }
      const cost = changed * WATER_TILE_ACTION_COST_CENTS;
      if (canAfford(w, cost)) {
        if (setWaterLevel(m, x, y, width, height, level)) {
          charge(w, LedgerCategory.Landscaping, cost);
        }
      }
      break;
    }
    case 'paintLand':
      if (canAfford(w, LAND_SURFACE_COST_CENTS))
        paintLand(m, c.x | 0, c.y | 0, c.width | 0, c.height | 0, c.surface | 0);
      break;
    case 'placePath':
      if (canAfford(w, PATH_COST_CENTS) && placePath(m, c))
        charge(w, LedgerCategory.Landscaping, PATH_COST_CENTS);
      break;
    case 'removePath':
      removePath(m, c);
      break;
    case 'setPathAddition':
      setPathAddition(m, c.x, c.y, c.addition);
      break;
    case 'buyLand': {
      const x = c.x | 0;
      const y = c.y | 0;
      const cost =
        buyable(m, x, y, c.width | 0, c.height | 0, c.rights) *
        (c.rights ? RIGHTS_PRICE_CENTS : LAND_PRICE_CENTS);
      if (cost > 0 && canAfford(w, cost)) {
        applyBuy(m, x, y, c.width | 0, c.height | 0, c.rights);
        charge(w, LedgerCategory.Land, cost);
      }
      break;
    }
  }
}
