import type { World } from '../core/world';
import { Z_STEP } from '../core/constants';
import { rideFootprintTiles } from '../rides/ride-footprint';
import { RIDE_CATALOG } from '../rides/ride-types';
import type { RideType } from '../rides/ride-types';
import { PIECES } from '../track/catalog';
import { rotateTile } from '../track/construction';
import { ElementType, MAX_HEIGHT, OWNED, PathFlag, SLOPE_DIR_SHIFT } from './tile-map';
import type { TileMap } from './tile-map';
import { editTerrain, LAND_HEIGHT_STEP_COST_CENTS, MAX_EDIT_SIZE, rampMask } from './land';
import type { TerrainEdit, VertexMover } from './land';
import { recomputePathEdges, PATH_CLEARANCE } from './paths';
import { SCENERY_CATALOG } from './scenery';
import type { SceneryItem } from './scenery';

export const enum LandAction {
  Raise = 0,
  Lower = 1,
  Flatten = 2,
  Smooth = 3,
}

/** Outcome of a land edit; codes are shared with the UI feedback channel. */
export const enum LandResult {
  Ok = 0,
  OutOfBounds = 1,
  NotOwned = 2,
  NoChange = 3,
  TooHigh = 4,
  TooLow = 5,
  RideInTheWay = 6,
  EntranceInTheWay = 7,
  ObjectInTheWay = 8,
  PathInTheWay = 9,
  InsufficientFunds = 10,
  InvalidEdit = 11,
}

export interface LandEdit {
  action: LandAction;
  /** Top-left tile and size of the selected square. */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Corner mask (bit c = corner c) for a single-tile raise or lower: one bit is a corner, two
   * adjacent bits an edge. Omitted or 0b1111 selects the whole tile.
   */
  corners?: number;
  /** Tile whose height a flatten levels to; defaults to the selection's first tile. */
  anchorX?: number;
  anchorY?: number;
}

export interface LandPlan {
  result: LandResult;
  /** Tile index the refusal points at, or -1. */
  subject: number;
  /** Total price: terrain plus scenery removal. */
  costCents: number;
  /** Vertex indexes (`TileMap.vertexIndex`) that change height. */
  vertices: Int32Array;
  /** Signed height change per entry of `vertices`. */
  deltas: Int8Array;
  /** Tile indexes with any corner that changes. */
  tiles: Int32Array;
  /** Selected tiles that are owned, whether or not the edit succeeds. */
  selected: Int32Array;
}

const CORNER_DX = [0, 1, 1, 0];
const CORNER_DY = [0, 0, 1, 1];
const NO_TILES: Int32Array<ArrayBuffer> = new Int32Array(0);

function refuse(result: LandResult, subject = -1, selected = NO_TILES): LandPlan {
  return {
    result,
    subject,
    costCents: 0,
    vertices: NO_TILES,
    deltas: new Int8Array(0),
    tiles: NO_TILES,
    selected,
  };
}

/** Owned tiles of a selected square, or why there are none. */
export function ownedSelection(
  m: TileMap,
  e: Pick<LandEdit, 'x' | 'y' | 'width' | 'height'>,
): Int32Array<ArrayBuffer> | LandResult {
  const { x, y, width, height } = e;
  if (![x, y, width, height].every(Number.isInteger)) return LandResult.InvalidEdit;
  if (width < 1 || height < 1 || width > MAX_EDIT_SIZE || height > MAX_EDIT_SIZE)
    return LandResult.InvalidEdit;
  const out: number[] = [];
  let inside = false;
  for (let ty = y; ty < y + height; ty++) {
    for (let tx = x; tx < x + width; tx++) {
      if (!m.inBounds(tx, ty)) continue;
      inside = true;
      const i = m.index(tx, ty);
      if ((m.ownership[i] & OWNED) !== 0) out.push(i);
    }
  }
  if (!inside) return LandResult.OutOfBounds;
  if (out.length === 0) return LandResult.NotOwned;
  return Int32Array.from(out);
}

function cornerMask(e: LandEdit): number {
  const mask = (e.corners ?? 0b1111) & 0b1111;
  return e.width === 1 && e.height === 1 && mask !== 0 ? mask : 0b1111;
}

function tileExtreme(m: TileMap, i: number, up: boolean): number {
  return m.heights[i] + (!up && m.slope[i] !== 0 ? 1 : 0);
}

/** Moves the selected vertices as the action describes. */
function applyAction(m: TileMap, e: LandEdit, tiles: Int32Array, move: VertexMover): void {
  const w = m.width;
  const vertexOf = (tile: number, c: number): [number, number] => [
    (tile % w) + CORNER_DX[c],
    ((tile / w) | 0) + CORNER_DY[c],
  ];
  if (e.action === LandAction.Raise || e.action === LandAction.Lower) {
    const up = e.action === LandAction.Raise;
    const mask = cornerMask(e);
    if (mask !== 0b1111) {
      for (let c = 0; c < 4; c++) {
        if (!(mask & (1 << c))) continue;
        const [vx, vy] = vertexOf(tiles[0], c);
        move(vx, vy, m.vertexHeights[m.vertexIndex(vx, vy)] + (up ? 1 : -1), up);
      }
      return;
    }
    let extreme = up ? MAX_HEIGHT + 2 : -1;
    for (const tile of tiles) {
      const h = tileExtreme(m, tile, up);
      extreme = up ? Math.min(extreme, h) : Math.max(extreme, h);
    }
    const seen = new Set<number>();
    for (const tile of tiles) {
      if (tileExtreme(m, tile, up) !== extreme) continue;
      for (let c = 0; c < 4; c++) {
        const [vx, vy] = vertexOf(tile, c);
        const v = m.vertexIndex(vx, vy);
        if (seen.has(v)) continue;
        seen.add(v);
        move(vx, vy, m.vertexHeights[v] + (up ? 1 : -1), up);
      }
    }
    return;
  }
  const vertices = new Map<number, [number, number]>();
  for (const tile of tiles)
    for (let c = 0; c < 4; c++) {
      const [vx, vy] = vertexOf(tile, c);
      vertices.set(m.vertexIndex(vx, vy), [vx, vy]);
    }
  if (e.action === LandAction.Flatten) {
    const ax = e.anchorX ?? tiles[0] % w;
    const ay = e.anchorY ?? (tiles[0] / w) | 0;
    const level = m.inBounds(ax, ay) ? m.heights[m.index(ax, ay)] : m.heights[tiles[0]];
    for (const [vx, vy] of vertices.values())
      if (m.vertexHeights[m.vertexIndex(vx, vy)] > level) move(vx, vy, level, false);
    for (const [vx, vy] of vertices.values())
      if (m.vertexHeights[m.vertexIndex(vx, vy)] < level) move(vx, vy, level, true);
    return;
  }
  const targets: Array<[number, number, number]> = [];
  for (const [vx, vy] of vertices.values()) {
    let sum = 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = vx + dx;
        const ny = vy + dy;
        if (nx < 0 || ny < 0 || nx > m.width || ny > m.height) continue;
        sum += m.vertexHeights[m.vertexIndex(nx, ny)];
        n++;
      }
    targets.push([vx, vy, Math.floor((2 * sum + n) / (2 * n))]);
  }
  for (const [vx, vy, target] of targets) {
    const current = m.vertexHeights[m.vertexIndex(vx, vy)];
    if (target !== current) move(vx, vy, target, target > current);
  }
}

function affectedTiles(m: TileMap, vertices: Int32Array): Int32Array {
  const w1 = m.width + 1;
  const mask = new Uint8Array(m.width * m.height);
  for (const v of vertices) {
    const vx = v % w1;
    const vy = (v / w1) | 0;
    for (let ty = vy - 1; ty <= vy; ty++)
      for (let tx = vx - 1; tx <= vx; tx++) if (m.inBounds(tx, ty)) mask[m.index(tx, ty)] = 1;
  }
  const out: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) out.push(i);
  return Int32Array.from(out);
}

/**
 * First tile among `tiles` a ride, stall, ride entrance or exit, or the park entrance occupies.
 * Track is only in the way where it runs within two steps of `oldTop` (or the ground).
 */
export function structureConflict(
  w: World,
  tiles: Int32Array,
  oldTop: Map<number, number>,
): LandPlan | null {
  const m = w.map;
  const flagged = new Uint8Array(m.width * m.height);
  for (const t of tiles) flagged[t] = 1;
  const hit = (result: LandResult, tile: number): LandPlan => refuse(result, tile);
  if (m.inBounds(w.park.entranceX, w.park.entranceY)) {
    const t = m.index(w.park.entranceX, w.park.entranceY);
    if (flagged[t]) return hit(LandResult.EntranceInTheWay, t);
  }
  const ride = w.rides.cols;
  for (let slot = 0; slot < w.rides.count; slot++) {
    const def = RIDE_CATALOG[ride.typeId[slot] as RideType];
    if (!def) continue;
    for (const [x, y] of rideFootprintTiles(
      def,
      ride.rideX[slot],
      ride.rideY[slot],
      ride.dir[slot],
    )) {
      if (m.inBounds(x, y) && flagged[m.index(x, y)])
        return hit(LandResult.RideInTheWay, m.index(x, y));
    }
    if (ride.entrancePlaced[slot] && m.inBounds(ride.entranceX[slot], ride.entranceY[slot])) {
      const t = m.index(ride.entranceX[slot], ride.entranceY[slot]);
      if (flagged[t]) return hit(LandResult.EntranceInTheWay, t);
    }
    if (ride.exitPlaced[slot] && m.inBounds(ride.exitX[slot], ride.exitY[slot])) {
      const t = m.index(ride.exitX[slot], ride.exitY[slot]);
      if (flagged[t]) return hit(LandResult.EntranceInTheWay, t);
    }
  }
  const pieces = w.track.pieces;
  for (let s = 0; s < pieces.count; s++) {
    const piece = PIECES[pieces.cols.pieceType[s]];
    for (const cell of piece.footprint) {
      const [rx, ry] = rotateTile(cell.i, cell.j, pieces.cols.dir[s]);
      const x = pieces.cols.x[s] + rx;
      const y = pieces.cols.y[s] + ry;
      if (!m.inBounds(x, y)) continue;
      const t = m.index(x, y);
      if (!flagged[t]) continue;
      const top = Math.max(oldTop.get(t) ?? 0, m.heights[t] + (m.slope[t] !== 0 ? 1 : 0));
      if (pieces.cols.z[s] * Z_STEP + cell.zMin <= (top + 2) * Z_STEP)
        return hit(LandResult.RideInTheWay, t);
    }
  }
  return null;
}

interface PathFix {
  tile: number;
  element: number;
  dir: number;
}

/** Elements of changed tiles: what must go, what must move, or what blocks the edit. */
function elementEffects(
  m: TileMap,
  tiles: Int32Array,
  oldBase: Map<number, number>,
): {
  block: LandPlan | null;
  scenery: Array<[number, number]>;
  paths: PathFix[];
  sceneryCents: number;
} {
  const scenery: Array<[number, number]> = [];
  const paths: PathFix[] = [];
  let sceneryCents = 0;
  for (const tile of tiles) {
    const base = m.heights[tile];
    const top = base + (m.slope[tile] !== 0 ? 1 : 0);
    let dir = -1;
    let rampOk = m.slope[tile] === 0;
    for (let d = 0; d < 4 && !rampOk; d++)
      if (rampMask(d) === m.slope[tile]) {
        dir = d;
        rampOk = true;
      }
    for (let e = m.firstElement(tile); e >= 0; e = m.nextElement(e)) {
      const type = m.elType[e];
      if (type === ElementType.SmallScenery) {
        scenery.push([tile, e]);
        sceneryCents += SCENERY_CATALOG[m.elData[e] as SceneryItem]?.removalPriceCents ?? 0;
      } else if (type === ElementType.Path) {
        const elevated = m.elBase[e] > (oldBase.get(tile) ?? base);
        if (elevated) {
          if (m.elBase[e] < top)
            return { block: refuse(LandResult.PathInTheWay, tile), scenery, paths, sceneryCents };
        } else if (!rampOk) {
          return { block: refuse(LandResult.PathInTheWay, tile), scenery, paths, sceneryCents };
        } else {
          paths.push({ tile, element: e, dir });
        }
      } else {
        return { block: refuse(LandResult.ObjectInTheWay, tile), scenery, paths, sceneryCents };
      }
    }
  }
  return { block: null, scenery, paths, sceneryCents };
}

function seatPath(m: TileMap, fix: PathFix): void {
  const e = fix.element;
  const ramp = fix.dir >= 0;
  m.elBase[e] = m.heights[fix.tile];
  m.elClear[e] = m.heights[fix.tile] + PATH_CLEARANCE + (ramp ? 1 : 0);
  m.elFlags[e] =
    (m.elFlags[e] & ~(PathFlag.Sloped | PathFlag.SlopeDir)) |
    (ramp ? PathFlag.Sloped | (fix.dir << SLOPE_DIR_SHIFT) : 0);
}

function evaluate(w: World, e: LandEdit, commit: boolean): LandPlan {
  const m = w.map;
  const selected = ownedSelection(m, e);
  if (typeof selected === 'number') return refuse(selected);
  const edited: TerrainEdit = editTerrain(m, (move) => applyAction(m, e, selected, move));
  const fail = (plan: LandPlan): LandPlan => {
    edited.rollback();
    return { ...plan, selected };
  };
  if (edited.changed.length === 0) {
    edited.rollback();
    const up = e.action === LandAction.Raise;
    const down = e.action === LandAction.Lower;
    return refuse(
      up ? LandResult.TooHigh : down ? LandResult.TooLow : LandResult.NoChange,
      -1,
      selected,
    );
  }
  const tiles = affectedTiles(m, edited.changed);
  // Heights of affected tiles before the edit, recovered from the vertices that moved.
  const w1 = m.width + 1;
  const beforeVertex = new Map<number, number>();
  edited.changed.forEach((v, k) => beforeVertex.set(v, edited.before[k]));
  const oldBase = new Map<number, number>();
  const oldTop = new Map<number, number>();
  for (const t of tiles) {
    const o = ((t / m.width) | 0) * w1 + (t % m.width);
    const corners = [o, o + 1, o + 1 + w1, o + w1].map(
      (v) => beforeVertex.get(v) ?? m.vertexHeights[v],
    );
    const low = Math.min(...corners);
    oldBase.set(t, low);
    oldTop.set(t, Math.max(...corners) > low ? low + 1 : low);
  }
  const blocked = structureConflict(w, tiles, oldTop);
  if (blocked) return fail(blocked);
  const effects = elementEffects(m, tiles, oldBase);
  if (effects.block) return fail(effects.block);
  let units = 0;
  edited.changed.forEach((v, k) => {
    units += Math.abs(m.vertexHeights[v] - edited.before[k]);
  });
  const costCents = units * LAND_HEIGHT_STEP_COST_CENTS + effects.sceneryCents;
  const plan: LandPlan = {
    result: LandResult.Ok,
    subject: -1,
    costCents,
    vertices: edited.changed,
    deltas: Int8Array.from(edited.changed, (v, k) => m.vertexHeights[v] - edited.before[k]),
    tiles,
    selected,
  };
  if (w.economy.cash < costCents) return fail({ ...plan, result: LandResult.InsufficientFunds });
  if (!commit) {
    edited.rollback();
    return plan;
  }
  for (const [tile, element] of effects.scenery) m.removeElement(tile, element);
  for (const fix of effects.paths) seatPath(m, fix);
  for (const fix of effects.paths) recomputePathEdges(m, fix.tile);
  for (const t of tiles) m.refreshTile(t);
  return plan;
}

/** Evaluates a land edit against the whole world and leaves the world unchanged. */
export function planLand(w: World, e: LandEdit): LandPlan {
  return evaluate(w, e, false);
}

/** Applies a land edit when it is allowed and affordable; the caller charges `costCents`. */
export function applyLand(w: World, e: LandEdit): LandPlan {
  return evaluate(w, e, true);
}
