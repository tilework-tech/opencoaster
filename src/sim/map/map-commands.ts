import type { World } from '../core/world';
import { LedgerCategory, post } from '../economy/ledger';
import { lowerLand, paintLand, raiseLand, setTileHeight, setWaterLevel } from './land';
import { placePath, removePath } from './paths';
import {
  LAND_EDIT_COST_CENTS,
  LAND_PRICE_CENTS,
  OWNED,
  PATH_COST_CENTS,
  RIGHTS_OWNED,
  RIGHTS_PRICE_CENTS,
  SALE_LAND,
  SALE_RIGHTS,
} from './tile-map';
import type { TileMap } from './tile-map';

/** Map-owned player commands; the core `Command` union includes this type. */
export type MapCommand =
  | { type: 'setTileHeight'; x: number; y: number; height: number }
  | { type: 'raiseLand'; x: number; y: number; width: number; height: number; corner?: number }
  | { type: 'lowerLand'; x: number; y: number; width: number; height: number; corner?: number }
  | { type: 'setWater'; x: number; y: number; width: number; height: number; level: number }
  | { type: 'paintLand'; x: number; y: number; width: number; height: number; surface: number }
  | { type: 'placePath'; x: number; y: number; z?: number; slope?: number; queue?: boolean }
  | { type: 'removePath'; x: number; y: number; z?: number }
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

/** Applies one map command to the world; invalid or unaffordable commands are ignored. */
export function applyMapCommand(w: World, c: MapCommand): void {
  const m = w.map;
  switch (c.type) {
    case 'setTileHeight':
      setTileHeight(m, c.x | 0, c.y | 0, c.height | 0);
      break;
    case 'raiseLand':
    case 'lowerLand': {
      const cost = (c.width | 0) * (c.height | 0) * LAND_EDIT_COST_CENTS;
      if (!canAfford(w, cost)) break;
      const edit = c.type === 'raiseLand' ? raiseLand : lowerLand;
      const corner = c.corner === undefined ? undefined : c.corner | 0;
      if (edit(m, c.x | 0, c.y | 0, c.width | 0, c.height | 0, corner))
        charge(w, LedgerCategory.Landscaping, cost);
      break;
    }
    case 'setWater':
      if (canAfford(w, LAND_EDIT_COST_CENTS)) {
        if (setWaterLevel(m, c.x | 0, c.y | 0, c.width | 0, c.height | 0, c.level | 0)) {
          charge(w, LedgerCategory.Landscaping, LAND_EDIT_COST_CENTS);
        }
      }
      break;
    case 'paintLand':
      paintLand(m, c.x | 0, c.y | 0, c.width | 0, c.height | 0, c.surface | 0);
      break;
    case 'placePath':
      if (canAfford(w, PATH_COST_CENTS) && placePath(m, c))
        charge(w, LedgerCategory.Landscaping, PATH_COST_CENTS);
      break;
    case 'removePath':
      removePath(m, c);
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
