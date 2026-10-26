import type { World } from '../core/world';
import { ElementType, MAX_HEIGHT, PathFlag, WATER_TILE_ACTION_COST_CENTS } from './tile-map';
import type { TileMap } from './tile-map';
import { LandResult, ownedSelection, structureConflict } from './land-tool';
import { SCENERY_CATALOG } from './scenery';
import type { SceneryItem } from './scenery';

const PATH_ADDITIONS = PathFlag.Bin | PathFlag.Bench | PathFlag.Shelter | PathFlag.Lamp;

/** Top-left tile and size of the square an area tool acts on. */
export interface AreaSquare {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A Clear scenery sweep, or one Water raise or lower step. */
export type AreaEdit =
  (AreaSquare & { tool: 'clear' }) | (AreaSquare & { tool: 'water'; lower: boolean });

export interface AreaPlan {
  /** Outcome; codes are shared with the land tool. */
  result: LandResult;
  /** Tile index the refusal points at, or -1. */
  subject: number;
  costCents: number;
  /** Selected tiles that are owned, whether or not the edit succeeds. */
  selected: Int32Array;
  /** Tiles the edit changes: tiles with something to clear, or tiles whose water level moves. */
  tiles: Int32Array;
  /** Water: the level the changed tiles move to (at or below the ground means dry). Clear: -1. */
  level: number;
  /** Clear: scenery items and footpath additions removed. Water: 0. */
  removed: number;
}

const NO_TILES: Int32Array<ArrayBuffer> = new Int32Array(0);

function refuse(result: LandResult, subject = -1, selected: Int32Array = NO_TILES): AreaPlan {
  return { result, subject, costCents: 0, selected, tiles: NO_TILES, level: -1, removed: 0 };
}

function isWet(m: TileMap, i: number): boolean {
  return m.waterLevel[i] > m.heights[i];
}

/** Water surface of a wet tile, or the ground of a dry one. */
function surfaceLevel(m: TileMap, i: number): number {
  return isWet(m, i) ? m.waterLevel[i] : m.heights[i];
}

function clearScenery(w: World, selected: Int32Array, commit: boolean): AreaPlan {
  const m = w.map;
  const scenery: Array<[number, number]> = [];
  const paths: Array<[number, number]> = [];
  const tiles: number[] = [];
  let costCents = 0;
  for (const tile of selected) {
    const before = scenery.length + paths.length;
    for (let e = m.firstElement(tile); e >= 0; e = m.nextElement(e)) {
      if (m.elType[e] === ElementType.SmallScenery) {
        scenery.push([tile, e]);
        costCents += SCENERY_CATALOG[m.elData[e] as SceneryItem]?.removalPriceCents ?? 0;
      } else if (m.elType[e] === ElementType.Path && (m.elFlags[e] & PATH_ADDITIONS) !== 0) {
        paths.push([tile, e]);
      }
    }
    if (scenery.length + paths.length > before) tiles.push(tile);
  }
  if (tiles.length === 0) return refuse(LandResult.NoChange, -1, selected);
  const plan: AreaPlan = {
    result: LandResult.Ok,
    subject: -1,
    costCents,
    selected,
    tiles: Int32Array.from(tiles),
    level: -1,
    removed: scenery.length + paths.length,
  };
  if (w.economy.cash < costCents) return { ...plan, result: LandResult.InsufficientFunds };
  if (!commit) return plan;
  for (const [, e] of paths) {
    m.elFlags[e] &= ~PATH_ADDITIONS;
    m.elData[e] = 0;
  }
  for (const [tile, e] of scenery) m.removeElement(tile, e);
  for (const tile of tiles) m.refreshTile(tile);
  return plan;
}

function moveWater(w: World, selected: Int32Array, lower: boolean, commit: boolean): AreaPlan {
  const m = w.map;
  let target: number;
  let changed: Int32Array;
  if (lower) {
    let high = -1;
    for (const t of selected) if (isWet(m, t)) high = Math.max(high, m.waterLevel[t]);
    if (high < 0) return refuse(LandResult.TooLow, -1, selected);
    target = high - 1;
    changed = selected.filter((t) => isWet(m, t) && m.waterLevel[t] === high);
  } else {
    let low = MAX_HEIGHT + 1;
    for (const t of selected) low = Math.min(low, surfaceLevel(m, t));
    target = low + 1;
    if (target > MAX_HEIGHT) return refuse(LandResult.TooHigh, -1, selected);
    changed = selected.filter((t) => surfaceLevel(m, t) === low);
  }
  const top = new Map<number, number>();
  for (const t of changed) top.set(t, target);
  const blocked = structureConflict(w, changed, top);
  if (blocked) return refuse(blocked.result, blocked.subject, selected);
  if (!lower)
    for (const t of changed)
      for (let e = m.firstElement(t); e >= 0; e = m.nextElement(e)) {
        if (m.elBase[e] >= target) continue;
        if (m.elType[e] === ElementType.Path) return refuse(LandResult.PathInTheWay, t, selected);
        return refuse(LandResult.ObjectInTheWay, t, selected);
      }
  const plan: AreaPlan = {
    result: LandResult.Ok,
    subject: -1,
    costCents: changed.length * WATER_TILE_ACTION_COST_CENTS,
    selected,
    tiles: changed,
    level: target,
    removed: 0,
  };
  if (w.economy.cash < plan.costCents) return { ...plan, result: LandResult.InsufficientFunds };
  if (!commit) return plan;
  for (const t of changed) {
    m.waterLevel[t] = target > m.heights[t] ? target : 0;
    m.refreshTile(t);
  }
  return plan;
}

function evaluate(w: World, e: AreaEdit, commit: boolean): AreaPlan {
  const selected = ownedSelection(w.map, e);
  if (typeof selected === 'number') return refuse(selected);
  return e.tool === 'clear'
    ? clearScenery(w, selected, commit)
    : moveWater(w, selected, e.lower, commit);
}

/** Evaluates an area edit against the whole world and leaves the world unchanged. */
export function planArea(w: World, e: AreaEdit): AreaPlan {
  return evaluate(w, e, false);
}

/** Applies an area edit when it is allowed and affordable; the caller charges `costCents`. */
export function applyArea(w: World, e: AreaEdit): AreaPlan {
  return evaluate(w, e, true);
}
