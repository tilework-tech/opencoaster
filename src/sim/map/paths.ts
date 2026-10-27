import { rampMask } from './land';
import {
  ElementType,
  MAX_ELEMENT_BASE,
  PATH_ENTRANCE_MARK,
  PATH_EXIT_MARK,
  PATH_KEPT_BITS,
  PATH_QUEUE_LINK_SHIFT,
  PATH_QUEUE_LINKS,
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
  /**
   * Direction (0..3) from this tile to the tile it continues, for a queue piece laid as part of a
   * drag. The piece links to that tile when it has a free link slot.
   */
  linkFrom?: number;
  /** Last piece of a drag: it also links to a neighbouring line end, such as a ride entrance. */
  linkEnd?: boolean;
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
    (addition === PathAddition.Bin ? 0xff : 0) | (m.elData[element] & PATH_KEPT_BITS);
  m.revision++;
  return true;
}

/** Path element of tile `n` whose height meets element `e`'s edge `dir` of tile `i`, or -1. */
export function adjoiningElement(m: TileMap, i: number, e: number, dir: number): number {
  return m.adjoiningPath(i, e, dir);
}

function isQueueElement(m: TileMap, e: number): boolean {
  return (m.elFlags[e] & PathFlag.Queue) !== 0;
}

/** Link slots of a queue piece: a line has two ends, so a piece links to at most two neighbours. */
const QUEUE_LINK_SLOTS = 2;

function popcount4(mask: number): number {
  return (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
}

/** Directions (bit `1 << dir`) in which queue element `e` is linked to its queue neighbours. */
export function queueLinkMask(m: TileMap, e: number): number {
  return (m.elData[e] & PATH_QUEUE_LINKS) >> PATH_QUEUE_LINK_SHIFT;
}

function setQueueLink(m: TileMap, e: number, dir: number, on: boolean): void {
  const bit = 1 << (PATH_QUEUE_LINK_SHIFT + dir);
  if (on) m.elData[e] |= bit;
  else m.elData[e] &= ~bit;
}

/** Free link slots of queue element `e`: a ride entrance ends a line, so it takes only one link. */
function freeLinkSlots(m: TileMap, e: number): number {
  const slots = m.elData[e] & PATH_ENTRANCE_MARK ? 1 : QUEUE_LINK_SLOTS;
  return slots - popcount4(queueLinkMask(m, e));
}

/**
 * Links queue element `e` of tile `i` to its queue neighbour across `dir` when both have a free
 * slot. Returns true when the two are linked afterwards.
 */
export function linkQueuePieces(m: TileMap, i: number, e: number, dir: number): boolean {
  const f = adjoiningElement(m, i, e, dir);
  if (f < 0 || !isQueueElement(m, e) || !isQueueElement(m, f)) return false;
  const back = (dir + 2) & 3;
  if (queueLinkMask(m, e) & (1 << dir)) return queueLinkMask(m, f) & (1 << back) ? true : false;
  if (freeLinkSlots(m, e) <= 0 || freeLinkSlots(m, f) <= 0) return false;
  setQueueLink(m, e, dir, true);
  setQueueLink(m, f, back, true);
  return true;
}

/** Keeps only the lowest-direction link of a ride entrance's queue piece, which ends its line. */
export function trimEntranceLinks(m: TileMap, i: number, e: number): void {
  const links = queueLinkMask(m, e);
  if (popcount4(links) <= 1) return;
  const keep = links & -links;
  for (let d = 0; d < 4; d++) {
    if (!(links & (1 << d)) || keep === 1 << d) continue;
    const f = adjoiningElement(m, i, e, d);
    if (f >= 0) setQueueLink(m, f, (d + 2) & 3, false);
    setQueueLink(m, e, d, false);
  }
}

/** Drops every link of queue element `e` of tile `i`, on its neighbours as well. */
export function unlinkQueuePiece(m: TileMap, i: number, e: number): void {
  const links = queueLinkMask(m, e);
  for (let d = 0; d < 4; d++) {
    if (!(links & (1 << d))) continue;
    const f = adjoiningElement(m, i, e, d);
    if (f >= 0) setQueueLink(m, f, (d + 2) & 3, false);
  }
  m.elData[e] &= ~PATH_QUEUE_LINKS;
}

/** Steps along the line from queue element `e` of tile `i` to the ride entrance, or Infinity. */
function entranceDistance(m: TileMap, i: number, e: number): number {
  let tile = i;
  let element = e;
  let came = -1;
  for (let steps = 0; steps <= m.width * m.height; steps++) {
    if (m.elData[element] & PATH_ENTRANCE_MARK) return steps;
    const links = queueLinkMask(m, element) & ~(came < 0 ? 0 : 1 << came);
    if (links === 0) return Infinity;
    const dir = Math.clz32(links & -links) ^ 31;
    const next = adjoiningElement(m, tile, element, dir);
    if (next < 0) return Infinity;
    tile = m.neighbor(tile, dir);
    element = next;
    came = (dir + 2) & 3;
  }
  return Infinity;
}

/** Whether the line through queue element `e` of tile `i` runs through tile `target`. */
function lineReaches(m: TileMap, i: number, e: number, target: number): boolean {
  const seen = new Set<number>([i]);
  const stack: Array<[number, number]> = [[i, e]];
  while (stack.length > 0) {
    const [tile, element] = stack.pop()!;
    if (tile === target) return true;
    const links = queueLinkMask(m, element);
    for (let d = 0; d < 4; d++) {
      if (!(links & (1 << d))) continue;
      const next = m.neighbor(tile, d);
      const f = adjoiningElement(m, tile, element, d);
      if (f < 0 || seen.has(next)) continue;
      seen.add(next);
      stack.push([next, f]);
    }
  }
  return false;
}

/**
 * Links a freshly laid queue piece to the line it extends: the drag predecessor when it has a free
 * slot, otherwise the neighbouring line end closest (along its line) to a ride entrance. A piece
 * links to one neighbour here, so a line never gains a junction, and never to its own line, so a
 * line never closes into a ring.
 */
function attachQueuePiece(m: TileMap, i: number, e: number, p: PathPlacement): void {
  const from = p.linkFrom ?? -1;
  const followed = from >= 0 && from <= 3 && linkQueuePieces(m, i, e, from);
  if (followed && !p.linkEnd) return;
  let best = -1;
  let bestDistance = Infinity;
  for (let d = 0; d < 4; d++) {
    if (queueLinkMask(m, e) & (1 << d)) continue;
    const f = adjoiningElement(m, i, e, d);
    if (f < 0 || !isQueueElement(m, f) || freeLinkSlots(m, f) <= 0) continue;
    if (lineReaches(m, i, e, m.neighbor(i, d))) continue;
    const distance = entranceDistance(m, m.neighbor(i, d), f);
    if (best < 0 || distance < bestDistance) {
      best = d;
      bestDistance = distance;
    }
  }
  if (best >= 0) linkQueuePieces(m, i, e, best);
}

/**
 * Direction in which queue element `e` of tile `i` joins an ordinary path, or -1. Only the open end
 * of a queue line has one: a piece with at most one link that is not a ride entrance already
 * joined to a line. It prefers continuing straight on from its link, and never joins a ride exit.
 */
export function queueOpening(m: TileMap, i: number, e: number): number {
  const links = queueLinkMask(m, e);
  const linked = popcount4(links);
  if (linked >= QUEUE_LINK_SLOTS) return -1;
  if (linked === 1 && m.elData[e] & PATH_ENTRANCE_MARK) return -1;
  const queueDir = linked === 1 ? Math.clz32(links) ^ 31 : -1;
  let first = -1;
  let straight = -1;
  for (let d = 0; d < 4; d++) {
    const f = adjoiningElement(m, i, e, d);
    if (f < 0 || isQueueElement(m, f) || m.elData[f] & PATH_EXIT_MARK) continue;
    if (first < 0) first = d;
    if (queueDir >= 0 && d === ((queueDir + 2) & 3)) straight = d;
  }
  return straight >= 0 ? straight : first;
}

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

/** Whether `e` of tile `i` joins the neighbouring element `f` across `dir` under the queue rules. */
function joins(m: TileMap, i: number, e: number, dir: number, f: number): boolean {
  const qe = isQueueElement(m, e);
  const qf = isQueueElement(m, f);
  if (qe && qf) {
    const back = (dir + 2) & 3;
    return (queueLinkMask(m, e) & (1 << dir)) !== 0 && (queueLinkMask(m, f) & (1 << back)) !== 0;
  }
  if (!qe && !qf) return true;
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
  const z = p.z ?? m.heights[i];
  const floating = p.z !== undefined && z >= m.heights[i] + (m.slope[i] !== 0 ? 1 : 0);
  const dir = requested >= 0 ? requested : floating ? -1 : terrainPathDirection(m, i);
  if (dir === null) return refusedPlan(PathResult.UnevenGround, i);
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
    ) {
      if (p.queue && (p.linkFrom !== undefined || p.linkEnd)) {
        attachQueuePiece(m, i, existing, p);
        recomputePathEdges(m, i);
      }
      return PathResult.Ok;
    }
    unlinkQueuePiece(m, i, existing);
    m.elFlags[existing] = (m.elFlags[existing] & ~keep) | flags;
    m.elClear[existing] = clear;
    m.pathStyle[existing] = style;
  } else if (m.addElement(i, ElementType.Path, z, clear, flags, 0) < 0) {
    return PathResult.Blocked;
  } else {
    m.pathStyle[m.pathElement(i, z)] = style;
  }
  if (p.queue) attachQueuePiece(m, i, m.pathElement(i, z), p);
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
  unlinkQueuePiece(m, i, e);
  m.removeElement(i, e);
  recomputePathEdges(m, i);
  return true;
}

const DRAG_DX = [1, 0, -1, 0];
const DRAG_DY = [0, 1, 0, -1];

/**
 * Marks each placement of a drag with the direction back to the placement before it, when the two
 * are edge-adjacent, so queue pieces laid in one drag link into a single line. The last piece also
 * links to a line end it reaches, so a drag that ends at a ride entrance joins it.
 */
export function withDragLinks(placements: readonly PathPlacement[]): PathPlacement[] {
  const last = placements.length - 1;
  return placements.map((p, k) => {
    const prev = placements[k - 1];
    if (!prev || p.linkFrom !== undefined) return p;
    for (let d = 0; d < 4; d++) {
      if (p.x + DRAG_DX[d]! === prev.x && p.y + DRAG_DY[d]! === prev.y)
        return { ...p, linkFrom: d, ...(k === last ? { linkEnd: true } : {}) };
    }
    return p;
  });
}
