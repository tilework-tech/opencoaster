import type { World } from '../core/world';
import { LedgerCategory, post } from '../economy/ledger';
import { FeedbackDomain, reportFeedback } from '../core/feedback';
import { paintLand, planSetTileHeight, setTileHeight, setWaterLevel } from './land';
import { applyLand, LandAction, LandResult } from './land-tool';
import { applyArea } from './area-tools';
import type { LandEdit } from './land-tool';
import {
  PathResult,
  placePathOutcome,
  planPathPlacement,
  queueLinks,
  removePath,
  withDragLinks,
  setPathAddition,
  type PathAddition,
  type PathPlacement,
} from './paths';
import {
  placeScenery,
  removeScenery,
  SCENERY_CATALOG,
  sceneryPlacementResult,
  SceneryResult,
  type SceneryItem,
} from './scenery';
import {
  LAND_SURFACE_COST_CENTS,
  LAND_PRICE_CENTS,
  OWNED,
  PATH_COST_CENTS,
  PATH_REFUND_CENTS,
  RIGHTS_OWNED,
  RIGHTS_PRICE_CENTS,
  WATER_TILE_ACTION_COST_CENTS,
  SALE_LAND,
  SALE_RIGHTS,
} from './tile-map';
import { PathFlag, PathStyle } from './tile-map';
import type { TileMap } from './tile-map';
import { TILE_UNITS, Z_STEP } from '../core/constants';
import { firstOccupancyBlocker, worldOccupancies } from './occupancy';
import type { OccupancyVolume } from './occupancy';

/** Map-owned player commands; the core `Command` union includes this type. */
export type MapCommand =
  | { type: 'setTileHeight'; x: number; y: number; height: number }
  | {
      type: 'raiseLand' | 'lowerLand';
      x: number;
      y: number;
      width: number;
      height: number;
      /** Corner index of a single-tile selection; superseded by `corners`. */
      corner?: number;
      /** Corner mask of a single-tile selection: one bit a corner, two adjacent bits an edge. */
      corners?: number;
    }
  | { type: 'smoothLand'; x: number; y: number; width: number; height: number }
  | {
      type: 'flattenLand';
      x: number;
      y: number;
      width: number;
      height: number;
      /** Tile whose height the area is levelled to. */
      anchorX: number;
      anchorY: number;
    }
  | { type: 'setWater'; x: number; y: number; width: number; height: number; level: number }
  /** One Water tool step: raises the lowest or lowers the highest water in the square. */
  | { type: 'raiseWater' | 'lowerWater'; x: number; y: number; width: number; height: number }
  /** Removes scenery and footpath additions from the owned tiles of the square. */
  | { type: 'clearScenery'; x: number; y: number; width: number; height: number }
  | { type: 'paintLand'; x: number; y: number; width: number; height: number; surface: number }
  | {
      type: 'placePath';
      x: number;
      y: number;
      z?: number;
      slope?: number;
      queue?: boolean;
      style?: PathStyle;
    }
  /** Lays a run of footpath pieces in order, each judged against the pieces before it. */
  | { type: 'placePathRun'; placements: PathPlacement[] }
  | { type: 'removePath'; x: number; y: number; z?: number }
  | { type: 'setPathAddition'; x: number; y: number; addition: PathAddition }
  | { type: 'placeScenery'; x: number; y: number; item: SceneryItem; rotation?: number }
  | { type: 'removeScenery'; x: number; y: number; edge?: number }
  | { type: 'buyLand'; x: number; y: number; width: number; height: number; rights: boolean };

/** Places one footpath piece, charging for it and reporting a refusal to the UI. */
function applyPathPlacement(w: World, c: PathPlacement): void {
  const m = w.map;
  const plan = planPathPlacement(m, c);
  const blocker = plan.result === PathResult.Ok ? pathOccupancyBlocker(w, m, c, plan) : undefined;
  const result = !canAfford(w, PATH_COST_CENTS)
    ? PathResult.InsufficientFunds
    : plan.result !== PathResult.Ok
      ? plan.result
      : blocker
        ? PathResult.Blocked
        : placePathOutcome(m, c);
  if (result === PathResult.Ok) charge(w, LedgerCategory.Landscaping, PATH_COST_CENTS);
  else
    reportFeedback(
      w.feedback,
      FeedbackDomain.Path,
      result,
      m.inBounds(c.x, c.y) ? m.index(c.x, c.y) : -1,
      blocker?.name,
    );
}

function pathOccupancyBlocker(
  w: World,
  map: TileMap,
  placement: PathPlacement,
  plan: ReturnType<typeof planPathPlacement>,
): OccupancyVolume | undefined {
  if (plan.result !== PathResult.Ok) return undefined;
  const candidate: OccupancyVolume = {
    tileX: placement.x,
    tileY: placement.y,
    base: plan.z * Z_STEP,
    clearance: plan.clear * Z_STEP,
    kind: placement.queue ? 'queue' : 'path',
    name: placement.queue ? 'Queue path' : 'Path',
    levelCrossing: !placement.queue && plan.dir < 0,
  };
  const occupants = worldOccupancies({ ...w, map } as World);
  return firstOccupancyBlocker(
    [candidate],
    occupants.filter(
      (item) =>
        !(
          plan.existing >= 0 &&
          item.tileX === placement.x &&
          item.tileY === placement.y &&
          (item.kind === 'path' || item.kind === 'queue') &&
          item.base === candidate.base
        ),
    ),
  );
}

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
    case 'setTileHeight': {
      const x = c.x | 0;
      const y = c.y | 0;
      const height = c.height | 0;
      const plan = planSetTileHeight(m, x, y, height);
      if (!plan.succeeds || !canAfford(w, plan.costCents)) break;
      const raised = raisedTerrainBlocker(w, x, y, height);
      if (raised) {
        reportFeedback(
          w.feedback,
          FeedbackDomain.Land,
          LandResult.ObjectInTheWay,
          raised.tileY * m.width + raised.tileX,
        );
        break;
      }
      if (setTileHeight(m, x, y, height)) {
        charge(w, LedgerCategory.Landscaping, plan.costCents);
        removeLitterOnTerrainTiles(w, plan.affectedTiles);
      }
      break;
    }
    case 'raiseLand':
    case 'lowerLand':
    case 'smoothLand':
    case 'flattenLand': {
      const edit: LandEdit = {
        action:
          c.type === 'raiseLand'
            ? LandAction.Raise
            : c.type === 'lowerLand'
              ? LandAction.Lower
              : c.type === 'smoothLand'
                ? LandAction.Smooth
                : LandAction.Flatten,
        x: c.x | 0,
        y: c.y | 0,
        width: c.width | 0,
        height: c.height | 0,
      };
      if (c.type === 'raiseLand' || c.type === 'lowerLand') {
        if (c.corners !== undefined) edit.corners = c.corners | 0;
        else if (c.corner !== undefined) edit.corners = 1 << (c.corner & 3);
      } else if (c.type === 'flattenLand') {
        edit.anchorX = c.anchorX | 0;
        edit.anchorY = c.anchorY | 0;
      }
      const plan = applyLand(w, edit);
      if (plan.result === LandResult.Ok) {
        charge(w, LedgerCategory.Landscaping, plan.costCents);
        const affected = new Uint8Array(m.width * m.height);
        for (const tile of plan.tiles) affected[tile] = 1;
        removeLitterOnTerrainTiles(w, affected);
      } else {
        reportFeedback(w.feedback, FeedbackDomain.Land, plan.result, plan.subject);
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
    case 'raiseWater':
    case 'lowerWater':
    case 'clearScenery': {
      const square = { x: c.x | 0, y: c.y | 0, width: c.width | 0, height: c.height | 0 };
      const water = c.type !== 'clearScenery';
      const plan = applyArea(
        w,
        water
          ? { tool: 'water', lower: c.type === 'lowerWater', ...square }
          : { tool: 'clear', ...square },
      );
      if (plan.result === LandResult.Ok) {
        charge(w, LedgerCategory.Landscaping, plan.costCents);
        if (water) {
          const flooded = new Uint8Array(m.width * m.height);
          for (const tile of plan.tiles) flooded[tile] = 1;
          removeLitterOnTerrainTiles(w, flooded);
        }
      } else
        reportFeedback(
          w.feedback,
          water ? FeedbackDomain.Water : FeedbackDomain.Clear,
          plan.result,
          plan.subject,
        );
      break;
    }
    case 'paintLand':
      if (canAfford(w, LAND_SURFACE_COST_CENTS))
        paintLand(m, c.x | 0, c.y | 0, c.width | 0, c.height | 0, c.surface | 0);
      break;
    case 'placePath':
      applyPathPlacement(w, c);
      break;
    case 'placePathRun':
      for (const placement of withDragLinks(c.placements)) applyPathPlacement(w, placement);
      break;
    case 'removePath':
      if (removePath(m, c)) post(w.economy, LedgerCategory.Landscaping, PATH_REFUND_CENTS);
      break;
    case 'setPathAddition':
      setPathAddition(m, c.x, c.y, c.addition);
      break;
    case 'placeScenery': {
      const item = SCENERY_CATALOG[c.item];
      if (
        item &&
        canAfford(w, item.priceCents) &&
        previewScenery(w, { x: c.x, y: c.y, item: c.item, rotation: c.rotation ?? 0 }) ===
          SceneryResult.Ok &&
        placeScenery(m, c.x, c.y, c.item, c.rotation)
      ) {
        charge(w, LedgerCategory.Landscaping, item.priceCents);
      }
      break;
    }
    case 'removeScenery': {
      const item = removeScenery(m, c.x, c.y, c.edge);
      if (item !== null)
        charge(w, LedgerCategory.Landscaping, SCENERY_CATALOG[item].removalPriceCents);
      break;
    }
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

function raisedTerrainBlocker(
  world: World,
  x: number,
  y: number,
  height: number,
): OccupancyVolume | undefined {
  const map = world.map;
  if (!map.inBounds(x, y)) return undefined;
  const simulated = map.clone();
  if (!setTileHeight(simulated, x, y, height)) return undefined;
  const existing = worldOccupancies(world);
  for (let tile = 0; tile < map.width * map.height; tile++) {
    const oldTop = map.heights[tile] + (map.slope[tile] ? 1 : 0);
    const nextTop = simulated.heights[tile] + (simulated.slope[tile] ? 1 : 0);
    if (nextTop <= oldTop) continue;
    const candidate: OccupancyVolume = {
      tileX: tile % map.width,
      tileY: (tile / map.width) | 0,
      base: oldTop * Z_STEP,
      clearance: nextTop * Z_STEP,
      kind: 'terrain',
      name: 'Raised terrain',
    };
    const blocker = firstOccupancyBlocker([candidate], existing);
    if (blocker) return blocker;
  }
  return undefined;
}

/** A scenery placement to judge: the tile, the item and the piece's rotation (0-3). */
export interface ScenerySpot {
  x: number;
  y: number;
  item: SceneryItem;
  rotation: number;
}

/**
 * Judges a `placeScenery` command without changing the map: the placement rules first, then whether
 * the world's cash covers the item. Matches what the command does when it is applied.
 */
export function previewScenery(w: World, spot: ScenerySpot): SceneryResult {
  const item = SCENERY_CATALOG[spot.item];
  if (!item) return SceneryResult.Invalid;
  const result = sceneryPlacementResult(w.map, spot.x, spot.y, spot.item, spot.rotation);
  if (result !== SceneryResult.Ok) return result;
  const tile = w.map.index(spot.x, spot.y);
  const base = (w.map.heights[tile] + (w.map.slope[tile] ? 1 : 0)) * Z_STEP;
  const edge = item.category === 'fences';
  const candidate: OccupancyVolume = {
    tileX: spot.x,
    tileY: spot.y,
    base,
    clearance: base + Math.max(1, item.height) * Z_STEP,
    kind: edge ? 'wall' : 'scenery',
    name: item.name,
    edgeMask: edge ? 1 << (spot.rotation & 3) : undefined,
  };
  if (firstOccupancyBlocker([candidate], worldOccupancies(w))) return SceneryResult.Blocked;
  return canAfford(w, item.priceCents) ? SceneryResult.Ok : SceneryResult.InsufficientFunds;
}

/** What one footpath piece in a previewed run would be, once the run is laid. */
export interface PathPiecePreview {
  result: PathResult;
  /** Base level of the piece; meaningful when `result` is Ok. */
  z: number;
  /** Direction the piece rises toward, or -1 for flat. */
  dir: number;
  queue: boolean;
  style: PathStyle;
  /** Edges (bit `1 << dir`) the piece joins to its neighbours once the whole run is laid. */
  edges: number;
  /** `QueueLink` bits for a queue piece: what its line connects to once the run is laid. */
  link: number;
}

/**
 * Previews `placePathRun` without changing the map: each piece is judged in order on a copy of the
 * map, with the cash the run would leave, and its final edges are read after the whole run.
 */
export function previewPathRun(w: World, placements: readonly PathPlacement[]): PathPiecePreview[] {
  const m = w.map.clone();
  let cash = w.economy.cash;
  const plans = withDragLinks(placements).map((p) => {
    const plan = planPathPlacement(m, p);
    if (plan.result !== PathResult.Ok) return plan;
    if (pathOccupancyBlocker(w, m, p, plan)) return { ...plan, result: PathResult.Blocked };
    if (cash < PATH_COST_CENTS) return { ...plan, result: PathResult.InsufficientFunds };
    placePathOutcome(m, p);
    cash -= PATH_COST_CENTS;
    return plan;
  });
  return plans.map((plan) => {
    if (plan.result !== PathResult.Ok) {
      return {
        result: plan.result,
        z: 0,
        dir: -1,
        queue: false,
        style: PathStyle.Tarmac,
        edges: 0,
        link: 0,
      };
    }
    const element = m.pathElement(plan.i, plan.z);
    return {
      result: PathResult.Ok,
      z: plan.z,
      dir: plan.dir,
      queue: (plan.flags & PathFlag.Queue) !== 0,
      style: plan.style,
      edges: element < 0 ? 0 : m.pathEdgesOf(element),
      link: queueLinks(m, plan.i),
    };
  });
}
