import { rampMask } from './land';
import {
  ElementType,
  MAX_ELEMENT_BASE,
  PATH_ENTRANCE_MARK,
  PATH_EXIT_MARK,
  PATH_BOARDING_MARKS,
  PathFlag,
  PathStyle,
  repairPathElement,
  SLOPE_DIR_SHIFT,
} from './tile-map';
import type { TileMap } from './tile-map';

/** Levels of headroom above a flat path; ramps add one for their raised end. */
export const PATH_CLEARANCE = 2;

/** Why a footpath placement was refused, or `Ok`. Codes are shared with the UI feedback channel. */
export const enum PathResult {
  Ok = 0,
  OutOfBounds = 1,
  NotOwned = 2,
  InvalidPiece = 3,
  BelowGround = 4,
  Underwater = 5,
  UnevenGround = 6,
  Blocked = 7,
  InsufficientFunds = 8,
}

export interface PathPlacement {
  x: number;
  y: number;
  /** Base level; defaults to the ground height of the tile. */
  z?: number;
  /**
   * Direction (0..3) the path rises toward, for a ramp. Omit (or pass -1) to follow the terrain:
   * flat ground gets a flat piece and a one-level slope gets a ramp facing its rise.
   */
  slope?: number;
  queue?: boolean;
  style?: PathStyle;
}

export interface PathRemoval {
  x: number;
  y: number;
  /** Base level of the piece to remove; defaults to the lowest path in the tile. */
  z?: number;
}

export const enum PathAddition {
  None = 0,
  Bin = 1,
  Bench = 2,
  Shelter = 3,
  Lamp = 4,
}

const PATH_ADDITION_FLAGS: Readonly<Record<number, number>> = {
  [PathAddition.Bin]: PathFlag.Bin,
  [PathAddition.Bench]: PathFlag.Bench,
  [PathAddition.Shelter]: PathFlag.Shelter,
  [PathAddition.Lamp]: PathFlag.Lamp,
};

export function setPathAddition(m: TileMap, x: number, y: number, addition: PathAddition): boolean {
  if (!m.inBounds(x, y) || !Number.isInteger(addition) || addition < 0 || addition > 4)
    return false;
  const tile = m.index(x, y);
  if (!m.canBuild(tile)) return false;
  const element = m.pathElement(tile, -1);
  if (element < 0) return false;
  m.elFlags[element] &= ~(PathFlag.Bin | PathFlag.Bench | PathFlag.Shelter | PathFlag.Lamp);
  m.elFlags[element] |= PATH_ADDITION_FLAGS[addition] ?? 0;
  m.elData[element] =
    (addition === PathAddition.Bin ? 0xff : 0) | (m.elData[element] & PATH_BOARDING_MARKS);
  m.revision++;
  return true;
}

/** Height level of path element `e` along edge `dir`, or -1 when that side cannot connect. */
function edgeHeight(m: TileMap, e: number, dir: number): number {
  const s = m.pathSlopeDir(e);
  const base = m.elBase[e];
  if (s < 0) return base;
  if (dir === s) return base + 1;
  if (dir === ((s + 2) & 3)) return base;
  return -1;
}

/** Path element of tile `n` whose height meets element `e`'s edge `dir` of tile `i`, or -1. */
function adjoiningElement(m: TileMap, i: number, e: number, dir: number): number {
  const h = edgeHeight(m, e, dir);
  const n = h < 0 ? -1 : m.neighbor(i, dir);
  if (n < 0) return -1;
  const back = (dir + 2) & 3;
  for (let f = m.firstElement(n); f >= 0; f = m.nextElement(f)) {
    if (m.elType[f] === ElementType.Path && edgeHeight(m, f, back) === h) return f;
  }
  return -1;
}

function isQueueElement(m: TileMap, e: number): boolean {
  return (m.elFlags[e] & PathFlag.Queue) !== 0;
}

/**
 * Direction in which queue element `e` of tile `i` joins an ordinary path, or -1. Only the open end
 * of a queue line has one: a piece with at most one queue neighbour that is not a ride entrance
 * already joined to a line. It prefers continuing straight on from its queue neighbour, and never
 * joins a ride exit.
 */
export function queueOpening(m: TileMap, i: number, e: number): number {
  let queueNeighbours = 0;
  let queueDir = -1;
  let first = -1;
  let straight = -1;
  for (let d = 0; d < 4; d++) {
    const f = adjoiningElement(m, i, e, d);
    if (f < 0) continue;
    if (isQueueElement(m, f)) {
      queueNeighbours++;
      queueDir = d;
    }
  }
  if (queueNeighbours >= 2) return -1;
  if (queueNeighbours === 1 && m.elData[e] & PATH_ENTRANCE_MARK) return -1;
  for (let d = 0; d < 4; d++) {
    const f = adjoiningElement(m, i, e, d);
    if (f < 0 || isQueueElement(m, f) || m.elData[f] & PATH_EXIT_MARK) continue;
    if (first < 0) first = d;
    if (queueDir >= 0 && d === ((queueDir + 2) & 3)) straight = d;
  }
  return straight >= 0 ? straight : first;
}

/** Whether `e` of tile `i` joins the neighbouring element across `dir` under the queue rules. */
/** What a queue line holds: bit 0 a ride entrance, bit 1 an open end joined to an ordinary path. */
export const enum QueueLink {
  Entrance = 1,
  OpenEnd = 2,
}

/** Walks the queue line through tile `i` and reports what it connects to (0 for a non-queue tile). */
export function queueLinks(m: TileMap, i: number): number {
  if (!m.isQueue(i)) return 0;
  const seen = new Set<number>([i]);
  const stack = [i];
  let links = 0;
  while (stack.length > 0) {
    const tile = stack.pop() as number;
    const e = m.pathElement(tile, -1);
    if (m.elData[e] & PATH_ENTRANCE_MARK) links |= QueueLink.Entrance;
    if (queueOpening(m, tile, e) >= 0) links |= QueueLink.OpenEnd;
    const edges = m.pathEdgesOf(e);
    for (let d = 0; d < 4; d++) {
      if (!(edges & (1 << d))) continue;
      const n = m.neighbor(tile, d);
      if (n >= 0 && !seen.has(n) && m.isQueue(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return links;
}

function joins(m: TileMap, i: number, e: number, dir: number, f: number): boolean {
  const qe = isQueueElement(m, e);
  const qf = isQueueElement(m, f);
  if (qe === qf) return true;
  if (qe) return queueOpening(m, i, e) === dir;
  const n = m.neighbor(i, dir);
  return queueOpening(m, n, f) === ((dir + 2) & 3) && !(m.elData[e] & PATH_EXIT_MARK);
}

function recomputeTileEdges(m: TileMap, i: number): void {
  for (let e = m.firstElement(i); e >= 0; e = m.nextElement(e)) {
    if (m.elType[e] !== ElementType.Path) continue;
    let edges = 0;
    for (let d = 0; d < 4; d++) {
      const f = adjoiningElement(m, i, e, d);
      if (f >= 0 && joins(m, i, e, d, f)) edges |= 1 << d;
    }
    m.elFlags[e] = (m.elFlags[e] & ~PathFlag.Edges) | edges;
  }
}

/**
 * Re-derives the joined-edge masks around a tile. A queue piece's opening depends on its own
 * neighbours, so the tiles two steps away are refreshed too.
 */
export function recomputePathEdges(m: TileMap, i: number): void {
  recomputeTileEdges(m, i);
  for (let d = 0; d < 4; d++) {
    const n = m.neighbor(i, d);
    if (n < 0) continue;
    recomputeTileEdges(m, n);
    for (let d2 = 0; d2 < 4; d2++) {
      const n2 = m.neighbor(n, d2);
      if (n2 >= 0 && n2 !== i) recomputeTileEdges(m, n2);
    }
  }
  m.pathVersion++;
  m.revision++;
}

/** Ramp direction the terrain of tile `i` forms, -1 for flat ground, or null when it is neither. */
function terrainPathDirection(m: TileMap, i: number): number | null {
  const mask = m.slope[i];
  if (mask === 0) return -1;
  for (let dir = 0; dir < 4; dir++) if (rampMask(dir) === mask) return dir;
  return null;
}

/** A validated footpath placement: where it goes, what it looks like, and what it replaces. */
export interface PathPlan {
  result: PathResult;
  /** Tile index, or -1 when refused before reaching a tile. */
  i: number;
  z: number;
  /** Direction the piece rises toward, or -1 for a flat piece. */
  dir: number;
  clear: number;
  /** Existing path element at `z` that the piece would replace, or -1. */
  existing: number;
  flags: number;
  style: PathStyle;
}

function refusedPlan(result: PathResult, i = -1): PathPlan {
  return {
    result,
    i,
    z: 0,
    dir: -1,
    clear: 0,
    existing: -1,
    flags: 0,
    style: PathStyle.Tarmac,
  };
}

/**
 * Checks a footpath placement without changing the map. A piece must rest on the ground (flat on
 * a flat tile, or a ramp on a matching slope) or float at or above the tile's highest corner,
 * must not be under water, and must not overlap another element's volume.
 */
export function planPathPlacement(m: TileMap, p: PathPlacement): PathPlan {
  if (!m.inBounds(p.x, p.y)) return refusedPlan(PathResult.OutOfBounds);
  const i = m.index(p.x, p.y);
  if (!m.canBuild(i)) return refusedPlan(PathResult.NotOwned, i);
  const requested = p.slope ?? -1;
  if (!Number.isInteger(requested) || requested < -1 || requested > 3)
    return refusedPlan(PathResult.InvalidPiece, i);
  const style = p.style ?? PathStyle.Tarmac;
  if (!Number.isInteger(style) || style < PathStyle.Tarmac || style > PathStyle.Dirt)
    return refusedPlan(PathResult.InvalidPiece, i);
  const dir = requested >= 0 ? requested : terrainPathDirection(m, i);
  if (dir === null) return refusedPlan(PathResult.UnevenGround, i);
  const z = p.z ?? m.heights[i];
  if (!Number.isInteger(z) || z > MAX_ELEMENT_BASE) return refusedPlan(PathResult.InvalidPiece, i);
  if (z < m.heights[i]) return refusedPlan(PathResult.BelowGround, i);

  const ramp = dir >= 0;
  const top = m.heights[i] + (m.slope[i] !== 0 ? 1 : 0);
  if (z < top && !(ramp && z === m.heights[i] && m.slope[i] === rampMask(dir)))
    return refusedPlan(PathResult.UnevenGround, i);
  if (m.waterLevel[i] > z) return refusedPlan(PathResult.Underwater, i);

  const clear = z + PATH_CLEARANCE + (ramp ? 1 : 0);
  const existing = m.pathElement(i, z);
  for (let e = m.firstElement(i); e >= 0; e = m.nextElement(e)) {
    if (e !== existing && m.elBase[e] < clear && z < m.elClear[e])
      return refusedPlan(PathResult.Blocked, i);
  }
  if (existing >= 0) {
    const marks = m.elData[existing];
    if (marks & PATH_ENTRANCE_MARK && !p.queue) return refusedPlan(PathResult.Blocked, i);
    if (marks & PATH_EXIT_MARK && p.queue) return refusedPlan(PathResult.Blocked, i);
  }
  const flags =
    (p.queue ? PathFlag.Queue : 0) | (ramp ? PathFlag.Sloped | (dir << SLOPE_DIR_SHIFT) : 0);
  return { result: PathResult.Ok, i, z, dir, clear, existing, flags, style };
}

/**
 * Places (or replaces in place) a path piece and reports the outcome. Validation is
 * `planPathPlacement`; this applies the plan.
 */
export function placePathOutcome(m: TileMap, p: PathPlacement): PathResult {
  const plan = planPathPlacement(m, p);
  if (plan.result !== PathResult.Ok) return plan.result;
  const { i, z, clear, existing, flags, style } = plan;
  repairPathElement(m, existing);

  const keep = PathFlag.Queue | PathFlag.Sloped | PathFlag.SlopeDir;
  if (existing >= 0) {
    if (
      (m.elFlags[existing] & keep) === flags &&
      m.elClear[existing] === clear &&
      m.pathStyle[existing] === style
    )
      return PathResult.Ok;
    m.elFlags[existing] = (m.elFlags[existing] & ~keep) | flags;
    m.elClear[existing] = clear;
    m.pathStyle[existing] = style;
  } else if (m.addElement(i, ElementType.Path, z, clear, flags, 0) < 0) {
    return PathResult.Blocked;
  } else {
    m.pathStyle[m.pathElement(i, z)] = style;
  }
  recomputePathEdges(m, i);
  m.refreshTile(i);
  return PathResult.Ok;
}

/** Boolean form of `placePathOutcome` for callers that only need to know whether it was placed. */
export function placePath(m: TileMap, p: PathPlacement): boolean {
  return placePathOutcome(m, p) === PathResult.Ok;
}

export function removePath(m: TileMap, p: PathRemoval): boolean {
  if (!m.inBounds(p.x, p.y)) return false;
  const i = m.index(p.x, p.y);
  if (!m.canBuild(i)) return false;
  const e = m.pathElement(i, p.z ?? -1);
  if (e < 0) return false;
  m.removeElement(i, e);
  recomputePathEdges(m, i);
  return true;
}
