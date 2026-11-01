import type { World } from '../core/world';
import { ElementType, MAX_HEIGHT, OWNED, PathFlag, WATER_TILE_ACTION_COST_CENTS } from './tile-map';
import type { TileMap } from './tile-map';
import { capBreachTile, LandResult, ownedSelection, structureConflict } from './land-tool';
import { isTreeScenery, SCENERY_CATALOG } from './scenery';
import { landscapingForbidden, treesProtected } from '../scenario/restrictions';
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

function clearScenery(w: World, selected: Int32Array, commit: boolean): AreaPlan {
  const m = w.map;
  const scenery: Array<[number, number]> = [];
  const paths: Array<[number, number]> = [];
  const tiles: number[] = [];
  let costCents = 0;
  const keepTrees = treesProtected(w);
  let keptTrees = 0;
  for (const tile of selected) {
    const before = scenery.length + paths.length;
    for (let e = m.firstElement(tile); e >= 0; e = m.nextElement(e)) {
      if (m.elType[e] === ElementType.SmallScenery) {
        if (keepTrees && isTreeScenery(m.elData[e] as SceneryItem)) {
          keptTrees++;
          continue;
        }
        scenery.push([tile, e]);
        costCents += SCENERY_CATALOG[m.elData[e] as SceneryItem]?.removalPriceCents ?? 0;
      } else if (m.elType[e] === ElementType.Path && (m.elFlags[e] & PATH_ADDITIONS) !== 0) {
        paths.push([tile, e]);
      }
    }
    if (scenery.length + paths.length > before) tiles.push(tile);
  }
  if (tiles.length === 0)
    return refuse(keptTrees > 0 ? LandResult.TreesProtected : LandResult.NoChange, -1, selected);
  const plan: AreaPlan = {
    result: LandResult.Ok,
    subject: -1,
    costCents,
    selected,
    tiles: Int32Array.from(tiles),
    level: -1,
    removed: scenery.length + paths.length,
  };
  if (costCents > 0 && w.economy.cash < costCents)
    return { ...plan, result: LandResult.InsufficientFunds };
  if (!commit) return plan;
  for (const [, e] of paths) {
    m.elFlags[e] &= ~PATH_ADDITIONS;
    m.elData[e] = 0;
  }
  for (const [tile, e] of scenery) m.removeElement(tile, e);
  for (const tile of tiles) m.refreshTile(tile);
  return plan;
}

/** Most tiles one water step may change; a bigger body is a spill onto open ground. */
export const MAX_WATER_BODY_TILES = 256;

const NEIGHBOUR_DX = [1, -1, 0, 0];
const NEIGHBOUR_DY = [0, 0, 1, -1];

function neighbour(m: TileMap, tile: number, n: number): number {
  const x = (tile % m.width) + NEIGHBOUR_DX[n];
  const y = ((tile / m.width) | 0) + NEIGHBOUR_DY[n];
  return m.inBounds(x, y) ? m.index(x, y) : -1;
}

function owned(m: TileMap, tile: number): boolean {
  return (m.ownership[tile] & OWNED) !== 0;
}

interface WaterStep {
  /** Tiles whose surface changes, in flood order. */
  tiles: number[];
  /** Surface of the body after the step. */
  level: number;
}

interface WaterRefusal {
  result: LandResult;
  subject: number;
}

function refusal(result: LandResult, subject: number): WaterRefusal {
  return { result, subject };
}

/** What stands on `tiles` that a surface at `level` would drown, or null when nothing does. */
function floodBlocker(w: World, tiles: number[], level: number): WaterRefusal | null {
  const m = w.map;
  const flooded = Int32Array.from(tiles);
  const top = new Map<number, number>();
  for (const t of flooded) top.set(t, level);
  const hit = structureConflict(w, flooded, top);
  if (hit) return refusal(hit.result, hit.subject);
  for (const t of flooded)
    for (let e = m.firstElement(t); e >= 0; e = m.nextElement(e)) {
      if (m.elType[e] !== ElementType.Path) return refusal(LandResult.ObjectInTheWay, t);
      if (m.elBase[e] < level) return refusal(LandResult.PathInTheWay, t);
    }
  return null;
}

/**
 * Raises the surface of the selection one step above its current surface (the highest water in it,
 * or the lowest ground when it is dry), then floods outward over every neighbouring tile whose
 * ground lies below the new surface, so the body stays one flat sheet bounded by banks.
 */
function raiseStep(w: World, selected: Int32Array): WaterStep | WaterRefusal {
  const m = w.map;
  let surface = -1;
  let lowestGround = MAX_HEIGHT + 1;
  for (const t of selected) {
    if (m.waterLevel[t] > m.heights[t]) surface = Math.max(surface, m.waterLevel[t]);
    lowestGround = Math.min(lowestGround, m.heights[t]);
  }
  if (surface < 0) surface = lowestGround;
  const level = surface + 1;
  if (level > MAX_HEIGHT) return refusal(LandResult.TooHigh, -1);
  const seen = new Uint8Array(m.width * m.height);
  const queue: number[] = [];
  for (const t of selected)
    if (m.heights[t] < level) {
      seen[t] = 1;
      queue.push(t);
    }
  const blocked = floodBlocker(w, queue, level);
  if (blocked) return blocked;
  let unowned = -1;
  for (let head = 0; head < queue.length; head++) {
    if (queue.length > MAX_WATER_BODY_TILES) return refusal(LandResult.WaterSpills, queue[0]);
    const t = queue[head];
    for (let n = 0; n < 4; n++) {
      const o = neighbour(m, t, n);
      if (o < 0 || seen[o]) continue;
      if (m.waterLevel[o] > level && m.waterLevel[o] > m.heights[o])
        return refusal(LandResult.WaterLevelClash, o);
      if (m.heights[o] >= level) continue;
      if (unowned < 0 && !owned(m, o)) unowned = o;
      seen[o] = 1;
      queue.push(o);
    }
  }
  if (unowned >= 0) return refusal(LandResult.NotOwned, unowned);
  const tiles = queue.filter((t) => m.waterLevel[t] !== level);
  return floodBlocker(w, tiles, level) ?? { tiles, level };
}

/**
 * Lowers the whole connected sheet of water at the selection's highest surface by one step; tiles
 * whose ground sits at or above the new surface go dry.
 */
function lowerStep(m: TileMap, selected: Int32Array): WaterStep | WaterRefusal {
  let surface = -1;
  for (const t of selected)
    if (m.waterLevel[t] > m.heights[t]) surface = Math.max(surface, m.waterLevel[t]);
  if (surface < 0) return refusal(LandResult.TooLow, -1);
  const seen = new Uint8Array(m.width * m.height);
  const queue: number[] = [];
  for (const t of selected)
    if (m.waterLevel[t] === surface && m.waterLevel[t] > m.heights[t]) {
      seen[t] = 1;
      queue.push(t);
    }
  for (let head = 0; head < queue.length; head++) {
    if (queue.length > MAX_WATER_BODY_TILES) return refusal(LandResult.WaterSpills, queue[0]);
    const t = queue[head];
    if (!owned(m, t)) return refusal(LandResult.NotOwned, t);
    for (let n = 0; n < 4; n++) {
      const o = neighbour(m, t, n);
      if (o < 0 || seen[o] || m.waterLevel[o] !== surface || m.waterLevel[o] <= m.heights[o])
        continue;
      seen[o] = 1;
      queue.push(o);
    }
  }
  return { tiles: queue, level: surface - 1 };
}

function moveWater(w: World, selected: Int32Array, lower: boolean, commit: boolean): AreaPlan {
  const m = w.map;
  const step = lower ? lowerStep(m, selected) : raiseStep(w, selected);
  if ('result' in step) return refuse(step.result, step.subject, selected);
  const changed = Int32Array.from(step.tiles);
  const target = step.level;
  if (lower) {
    const breach = capBreachTile(w, changed, (t) => Math.max(m.heights[t], target));
    if (breach >= 0) return refuse(LandResult.HeightLimit, breach, selected);
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
  if (e.tool === 'water' && landscapingForbidden(w)) return refuse(LandResult.LandscapingForbidden);
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

/**
 * Brings every connected body of water to one flat surface, the lowest any of its tiles had, so
 * ground above that surface goes dry. Used for worlds saved before water was one sheet per body.
 */
export function flattenWaterBodies(m: TileMap): void {
  const seen = new Uint8Array(m.width * m.height);
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || m.waterLevel[start] <= m.heights[start]) continue;
    const body = [start];
    seen[start] = 1;
    let surface = m.waterLevel[start];
    for (let head = 0; head < body.length; head++) {
      surface = Math.min(surface, m.waterLevel[body[head]]);
      for (let n = 0; n < 4; n++) {
        const o = neighbour(m, body[head], n);
        if (o < 0 || seen[o] || m.waterLevel[o] <= m.heights[o]) continue;
        seen[o] = 1;
        body.push(o);
      }
    }
    for (const t of body) {
      m.waterLevel[t] = surface > m.heights[t] ? surface : 0;
      m.refreshTile(t);
    }
  }
}
