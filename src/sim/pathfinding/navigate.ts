import type { Prng } from '../core/prng';
import { DIR_DX, DIR_DY, DIR_NONE, oppositeDir, popcount4 } from './directions';
import type { PathWorld } from './graph';
import { resolveGraph } from './graph';
import type { PathNetwork } from './network';
import { networkFor, QUEUE_CAP } from './network';

type RngLike = Pick<Prng, 'int'>;

export interface NavOptions {
  /** Direction the entity just moved in; the reverse is avoided unless at a dead end. */
  fromDir: number;
  /**
   * Junction budget per decision. A junction costs 1, or 2 when the corridor leading to it had
   * no choice along the way; corridor tiles themselves are free.
   */
  maxJunctions: number;
  /** Total corridor tiles one decision may traverse. */
  maxTiles: number;
  /** Search radius (Chebyshev, tiles) around the start tile. */
  maxDistance: number;
  /** Tiles walked since the current target was chosen. */
  stepsTaken: number;
  /** Past this many steps the entity is lost and wanders. Use a huge value to never get lost. */
  lostAfter: number;
  /** Per-tile mask (1 = inside). When set, movement is confined to it; outside tiles route back in. */
  patrol: PatrolMask | null;
}

export type PatrolMask = Uint8Array | { contains(tile: number): boolean };

function patrolContains(patrol: PatrolMask, tile: number): boolean {
  return patrol instanceof Uint8Array ? patrol[tile] !== 0 : patrol.contains(tile);
}

export const DEFAULT_GUEST_OPTS: Readonly<NavOptions> = {
  fromDir: DIR_NONE,
  maxJunctions: 16,
  maxTiles: 15000,
  maxDistance: 200,
  stepsTaken: 0,
  lostAfter: 0x7fffffff,
  patrol: null,
};

export const DEFAULT_STAFF_OPTS: Readonly<NavOptions> = {
  ...DEFAULT_GUEST_OPTS,
  maxJunctions: 16,
  maxTiles: 50000,
};

/** Distance score per tile: the original scores in 32-unit tiles and divides by 16. */
const SCORE_PER_TILE = 2;
const MAX_JUNCTIONS_CAP = QUEUE_CAP / 4;
const INF = 0x7fffffff;

/** What the last `nextDirection` call knew about a goal. */
export const enum SearchOutcome {
  /** No goal-directed choice was made: wandering, a single exit, or no step. */
  Unsearched = 0,
  /** The search ended without finding the target, so the step was a guess. */
  Blind = 1,
  /** The search found the target within its budget. */
  Seen = 2,
}

let lastOutcome = SearchOutcome.Unsearched;

export function lastSearchOutcome(): SearchOutcome {
  return lastOutcome;
}

const bestScore = new Int32Array(4);
const bestSteps = new Int32Array(4);

/**
 * Chooses the direction an entity standing on path tile `tile` should step next, or DIR_NONE.
 * `target < 0` means wander. Goal-directed search is limited to `opts.maxJunctions` junctions, so
 * far targets are approached greedily and entities can take wrong turns, as intended.
 */
export function nextDirection(
  world: PathWorld,
  tile: number,
  target: number,
  rng: RngLike,
  opts: Readonly<NavOptions> = DEFAULT_GUEST_OPTS,
): number {
  lastOutcome = SearchOutcome.Unsearched;
  const graph = resolveGraph(world.map);
  const net = networkFor(graph);
  const mask = graph.edgeMask(tile);
  if (mask === 0 || tile === target) return DIR_NONE;

  const patrol = opts.patrol;
  if (patrol !== null) return patrolDirection(net, tile, target, rng, opts, patrol);

  let cand = mask;
  if (opts.fromDir >= 0 && popcount4(mask) > 1) cand &= ~(1 << oppositeDir(opts.fromDir));
  if (target >= 0 && net.component(tile) !== net.component(target)) return DIR_NONE;
  if (popcount4(cand) === 1) return lowestDir(cand);

  if (target < 0 || opts.stepsTaken > opts.lostAfter) return pickDir(cand, rng);
  return searchDirection(net, tile, target, cand, rng, opts);
}

/** True if a walkable route joins the two tiles (optionally staying inside a patrol mask). */
export function isReachable(
  world: PathWorld,
  from: number,
  to: number,
  patrol: PatrolMask | null = null,
): boolean {
  const graph = resolveGraph(world.map);
  const net = networkFor(graph);
  if (graph.edgeMask(from) === 0 || graph.edgeMask(to) === 0) return false;
  if (from === to) return true;
  if (patrol === null) return net.component(from) === net.component(to);
  if (!patrolContains(patrol, from) || !patrolContains(patrol, to)) return false;
  return bfsFirstDir(net, from, to, patrol, true, INF) !== DIR_NONE;
}

function lowestDir(mask: number): number {
  return mask & 1 ? 0 : mask & 2 ? 1 : mask & 4 ? 2 : 3;
}

function pickDir(mask: number, rng: RngLike): number {
  const n = popcount4(mask);
  if (n === 0) return DIR_NONE;
  let k = n === 1 ? 0 : rng.int(n);
  for (let d = 0; d < 4; d++) {
    if ((mask & (1 << d)) === 0) continue;
    if (k-- === 0) return d;
  }
  return DIR_NONE;
}

/** Room for the secondary gap below the primary score; maps are far smaller than this. */
const SECONDARY_RANGE = 4096;

/**
 * Original distance score (the smaller of the x and y gaps, in score units, lower is closer),
 * ranked first. The larger gap breaks ties between nodes level with the target on one axis,
 * which the original's rule alone cannot tell apart.
 */
function distanceScore(a: number, b: number, w: number): number {
  const dx = (a % w) - (b % w);
  const dy = ((a / w) | 0) - ((b / w) | 0);
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  return (ax < ay ? ax : ay) * SCORE_PER_TILE * SECONDARY_RANGE + (ax < ay ? ay : ax);
}

/** Budget cost of arriving at a junction through a corridor of `len` steps. */
function junctionCost(len: number): number {
  return len > 1 ? 2 : 1;
}

function chebyshev(a: number, b: number, w: number): number {
  const dx = (a % w) - (b % w);
  const dy = ((a / w) | 0) - ((b / w) | 0);
  return Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy);
}

function offer(first: number, score: number, steps: number): void {
  if (score < bestScore[first] || (score === bestScore[first] && steps < bestSteps[first])) {
    bestScore[first] = score;
    bestSteps[first] = steps;
  }
}

/**
 * Breadth-first over junction nodes. Each candidate first step keeps the best (score, steps) seen
 * through it, where score is the distance score of a reached node to the target (0 = target
 * found on the way). A node is expanded only while the cost of reaching it is within the budget.
 */
function searchDirection(
  net: PathNetwork,
  start: number,
  target: number,
  cand: number,
  rng: RngLike,
  opts: Readonly<NavOptions>,
): number {
  const g = net.graph;
  const w = g.width;
  bestScore.fill(INF);
  bestSteps.fill(INF);

  // A target with two exits lies inside a corridor; remember the two corridor ends so a link
  // walked from a junction can be recognised as containing it.
  const tMask = g.edgeMask(target);
  let ea = -1;
  let da = 0;
  let la = 0;
  let eb = -1;
  let db = 0;
  let lb = 0;
  if (popcount4(tMask) === 2) {
    const a = lowestDir(tMask);
    const b = lowestDir(tMask & ~(1 << a));
    const sa = net.link(target, a);
    if (sa >= 0) {
      ea = sa;
      da = oppositeDir(net.linkArr[target * 4 + a]);
      la = net.linkLen[target * 4 + a];
    }
    const sb = net.link(target, b);
    if (sb >= 0) {
      eb = sb;
      db = oppositeDir(net.linkArr[target * 4 + b]);
      lb = net.linkLen[target * 4 + b];
    }
  }

  const visit = net.newVisitSet();
  const { qNode, qArr, qFirst, qSteps, qCost, stamp } = net;
  let head = 0;
  let tail = 0;
  net.stamp[start] = visit;

  for (let d = 0; d < 4; d++) {
    if ((cand & (1 << d)) === 0) continue;
    net.walk(start, d, target);
    if (net.walkHit >= 0) {
      offer(d, 0, net.walkHit);
      continue;
    }
    const e = net.walkEnd;
    if (e < 0 || net.walkLen > opts.maxTiles) continue;
    offer(d, e === target ? 0 : distanceScore(e, target, w), net.walkLen);
    if (e !== target && stamp[e] !== visit && tail < QUEUE_CAP) {
      stamp[e] = visit;
      qNode[tail] = e;
      qArr[tail] = net.walkArr;
      qFirst[tail] = d;
      qSteps[tail] = net.walkLen;
      qCost[tail] = junctionCost(net.walkLen);
      tail++;
    }
  }

  const maxJ = Math.min(opts.maxJunctions, MAX_JUNCTIONS_CAP);
  while (head < tail) {
    const node = qNode[head];
    const back = oppositeDir(qArr[head]);
    const first = qFirst[head];
    const steps = qSteps[head];
    const cost = qCost[head];
    head++;
    if (cost > maxJ) continue;
    const m = g.edgeMask(node);
    for (let d = 0; d < 4; d++) {
      if ((m & (1 << d)) === 0 || d === back) continue;
      if ((node === ea && d === da) || (node === eb && d === db)) {
        offer(first, 0, steps + (node === ea && d === da ? la : lb));
        continue;
      }
      const e = net.link(node, d);
      if (e < 0) continue;
      const total = steps + net.linkLen[node * 4 + d];
      if (total > opts.maxTiles || chebyshev(e, start, w) > opts.maxDistance) continue;
      offer(first, e === target ? 0 : distanceScore(e, target, w), total);
      if (e !== target && stamp[e] !== visit && tail < QUEUE_CAP) {
        stamp[e] = visit;
        qNode[tail] = e;
        qArr[tail] = net.linkArr[node * 4 + d];
        qFirst[tail] = first;
        qSteps[tail] = total;
        const next = cost + junctionCost(net.linkLen[node * 4 + d]);
        qCost[tail] = next < 255 ? next : 255;
        tail++;
      }
    }
  }

  let bs = INF;
  let bt = INF;
  let ties = 0;
  for (let d = 0; d < 4; d++) {
    if (bestScore[d] === INF) continue;
    if (bestScore[d] < bs || (bestScore[d] === bs && bestSteps[d] < bt)) {
      bs = bestScore[d];
      bt = bestSteps[d];
      ties = 1;
    } else if (bestScore[d] === bs && bestSteps[d] === bt) ties++;
  }
  if (ties === 0) return pickDir(cand, rng);
  lastOutcome = bs === 0 ? SearchOutcome.Seen : SearchOutcome.Blind;
  let k = ties === 1 ? 0 : rng.int(ties);
  for (let d = 0; d < 4; d++) {
    if (bestScore[d] === bs && bestSteps[d] === bt && k-- === 0) return d;
  }
  return DIR_NONE;
}

/** Patrol movement: tile-level, confined to `patrol`; outside tiles head for the nearest inside tile. */
function patrolDirection(
  net: PathNetwork,
  tile: number,
  target: number,
  rng: RngLike,
  opts: Readonly<NavOptions>,
  patrol: PatrolMask,
): number {
  const g = net.graph;
  const w = g.width;
  const mask = g.edgeMask(tile);
  if (!patrolContains(patrol, tile))
    return bfsFirstDir(net, tile, -1, patrol, false, opts.maxTiles);

  if (target >= 0 && patrolContains(patrol, target) && opts.stepsTaken <= opts.lostAfter) {
    const d = bfsFirstDir(net, tile, target, patrol, true, opts.maxTiles);
    if (d !== DIR_NONE) return d;
  }

  let inside = 0;
  let insideNoBack = 0;
  for (let d = 0; d < 4; d++) {
    if ((mask & (1 << d)) === 0) continue;
    if (!patrolContains(patrol, tile + DIR_DX[d] + DIR_DY[d] * w)) continue;
    inside |= 1 << d;
    if (d !== oppositeDir(opts.fromDir)) insideNoBack |= 1 << d;
  }
  return pickDir(insideNoBack !== 0 ? insideNoBack : inside, rng);
}

/**
 * Tile-level BFS returning the first step of a shortest route. Goal is `target` when >= 0, else
 * any tile with patrol[tile] === 1. With `restrict`, only patrol tiles are traversed.
 */
function bfsFirstDir(
  net: PathNetwork,
  start: number,
  target: number,
  patrol: PatrolMask,
  restrict: boolean,
  budget: number,
): number {
  const g = net.graph;
  const w = g.width;
  const visit = net.newVisitSet();
  const { tileQueue: q, tileFirst: first, stamp } = net;
  let head = 0;
  let tail = 0;
  q[tail++] = start;
  stamp[start] = visit;
  let seen = 0;
  while (head < tail && seen++ < budget) {
    const t = q[head++];
    const m = g.edgeMask(t);
    for (let d = 0; d < 4; d++) {
      if ((m & (1 << d)) === 0) continue;
      const nb = t + DIR_DX[d] + DIR_DY[d] * w;
      if (stamp[nb] === visit) continue;
      if (restrict && !patrolContains(patrol, nb)) continue;
      const f = t === start ? d : first[t];
      if (target >= 0 ? nb === target : patrolContains(patrol, nb)) return f;
      stamp[nb] = visit;
      first[nb] = f;
      q[tail++] = nb;
    }
  }
  return DIR_NONE;
}
