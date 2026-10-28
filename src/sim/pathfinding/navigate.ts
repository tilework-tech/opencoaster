import type { Prng } from '../core/prng';
import { DIR_NONE, oppositeDir, popcount4 } from './directions';
import type { PathWorld } from './graph';
import { nodeTile, resolveGraph, stepNode } from './graph';
import type { PathGraph } from './graph';
import type { PathNetwork } from './network';
import { networkFor, QUEUE_CAP } from './network';

type RngLike = Pick<Prng, 'int'>;

/** Junctions a guest looks ahead through when walking the park without a map. */
export const GUEST_JUNCTIONS = 5;
/** Junctions a guest holding a park map looks ahead through. */
export const GUEST_MAP_JUNCTIONS = 7;
/** Junctions a guest heading for the exit looks ahead through. */
export const GUEST_LEAVING_JUNCTIONS = 7;
/** Junctions a guest heading for the exit looks ahead through once it has been lost for a while. */
export const GUEST_LEAVING_LOST_JUNCTIONS = 8;
/** Junctions staff look ahead through. */
export const STAFF_JUNCTIONS = 8;

/** Junctions of a goal-directed walk that are remembered. */
const MEMORY_SLOTS = 4;

/**
 * The last few junctions an entity passed through on its way to one goal, each with the exits it
 * has not taken yet. Back at a remembered junction it chooses among the untried exits, so it works
 * through the alternatives instead of repeating the same wrong turn. Choosing a new goal clears it.
 */
export interface JunctionMemory {
  /** Goal node plus one the memory belongs to; 0 = none. */
  goal: number;
  /** Slot the next new junction is written to. */
  cursor: number;
  /** `(node + 1) << 4 | untried exits`; 0 = empty. */
  slots: Int32Array;
}

export function createJunctionMemory(): JunctionMemory {
  return { goal: 0, cursor: 0, slots: new Int32Array(MEMORY_SLOTS) };
}

export interface NavOptions {
  /** Direction the entity just moved in; the reverse is avoided unless at a dead end. */
  fromDir: number;
  /** Junction budget per decision. Every junction costs 1; corridor tiles are free. */
  maxJunctions: number;
  /** Total corridor tiles one decision may traverse. */
  maxTiles: number;
  /** Search radius (Chebyshev, tiles) around the start tile. */
  maxDistance: number;
  /** When wandering aimlessly, go straight on half the time if that exit is open. */
  straightBias: boolean;
  /** Junctions passed on the way to the current goal; null = none remembered. */
  memory: JunctionMemory | null;
  /** Per-tile mask (1 = inside). When set, movement is confined to it; outside tiles route back in. */
  patrol: PatrolMask | null;
}

export type PatrolMask = Uint8Array | { contains(tile: number): boolean };

function patrolContains(patrol: PatrolMask, tile: number): boolean {
  return patrol instanceof Uint8Array ? patrol[tile] !== 0 : patrol.contains(tile);
}

export const DEFAULT_GUEST_OPTS: Readonly<NavOptions> = {
  fromDir: DIR_NONE,
  maxJunctions: GUEST_JUNCTIONS,
  maxTiles: 15000,
  maxDistance: 200,
  straightBias: true,
  memory: null,
  patrol: null,
};

export const DEFAULT_STAFF_OPTS: Readonly<NavOptions> = {
  ...DEFAULT_GUEST_OPTS,
  maxJunctions: STAFF_JUNCTIONS,
  maxTiles: 50000,
  straightBias: false,
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

  if (target < 0) return wanderDirection(cand, rng, opts);
  const memory = opts.memory;
  if (memory === null) return searchDirection(net, tile, target, cand, rng, opts);
  return rememberedDirection(net, tile, target, mask, cand, rng, opts, memory);
}

/** Aimless walking: straight on half the time when that exit is open, else any open exit. */
function wanderDirection(cand: number, rng: RngLike, opts: Readonly<NavOptions>): number {
  if (opts.straightBias && opts.fromDir >= 0 && (cand & (1 << opts.fromDir)) !== 0) {
    if (rng.int(2) === 0) return opts.fromDir;
  }
  return pickDir(cand, rng);
}

/**
 * Goal-directed choice at a junction with memory. A junction with three or more exits is
 * remembered along with the exits not yet taken; coming back to it the entity chooses among those,
 * and when none are left every exit becomes available again.
 */
function rememberedDirection(
  net: PathNetwork,
  tile: number,
  target: number,
  mask: number,
  cand: number,
  rng: RngLike,
  opts: Readonly<NavOptions>,
  memory: JunctionMemory,
): number {
  const slots = memory.slots;
  if (memory.goal !== target + 1) {
    memory.goal = target + 1;
    memory.cursor = 0;
    slots.fill(0);
  }
  if (popcount4(mask) < 3) return searchDirection(net, tile, target, cand, rng, opts);

  const key = (tile + 1) << 4;
  let at = -1;
  for (let i = 0; i < MEMORY_SLOTS; i++) {
    if (slots[i] >> 4 === tile + 1) at = i;
  }
  const choices = at >= 0 ? slots[at] & 15 & cand || cand : cand;
  const dir = searchDirection(net, tile, target, choices, rng, opts);
  if (dir === DIR_NONE) return dir;
  if (at < 0) {
    at = memory.cursor;
    memory.cursor = (at + 1) & (MEMORY_SLOTS - 1);
  }
  slots[at] = key | (choices & ~(1 << dir));
  return dir;
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
  if (patrol === null) return !net.isSourceOnly(to) && net.component(from) === net.component(to);
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
function distanceScore(a: number, b: number, g: PathGraph): number {
  const w = g.width;
  const ta = nodeTile(g, a);
  const tb = nodeTile(g, b);
  const dx = (ta % w) - (tb % w);
  const dy = ((ta / w) | 0) - ((tb / w) | 0);
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  return (ax < ay ? ax : ay) * SCORE_PER_TILE * SECONDARY_RANGE + (ax < ay ? ay : ax);
}

/** Budget cost of arriving at a junction. */
const JUNCTION_COST = 1;

function chebyshev(a: number, b: number, g: PathGraph): number {
  const w = g.width;
  const ta = nodeTile(g, a);
  const tb = nodeTile(g, b);
  const dx = (ta % w) - (tb % w);
  const dy = ((ta / w) | 0) - ((tb / w) | 0);
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
    offer(d, e === target ? 0 : distanceScore(e, target, g), net.walkLen);
    if (e !== target && stamp[e] !== visit && tail < QUEUE_CAP) {
      stamp[e] = visit;
      qNode[tail] = e;
      qArr[tail] = net.walkArr;
      qFirst[tail] = d;
      qSteps[tail] = net.walkLen;
      qCost[tail] = JUNCTION_COST;
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
      if (total > opts.maxTiles || chebyshev(e, start, g) > opts.maxDistance) continue;
      offer(first, e === target ? 0 : distanceScore(e, target, g), total);
      if (e !== target && stamp[e] !== visit && tail < QUEUE_CAP) {
        stamp[e] = visit;
        qNode[tail] = e;
        qArr[tail] = net.linkArr[node * 4 + d];
        qFirst[tail] = first;
        qSteps[tail] = total;
        const next = cost + JUNCTION_COST;
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
    if (!patrolContains(patrol, nodeTile(g, stepNode(g, tile, d)))) continue;
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
      const nb = stepNode(g, t, d);
      if (stamp[nb] === visit) continue;
      if (restrict && !patrolContains(patrol, nodeTile(g, nb))) continue;
      const f = t === start ? d : first[t];
      if (target >= 0 ? nb === target : patrolContains(patrol, nodeTile(g, nb))) return f;
      stamp[nb] = visit;
      first[nb] = f;
      q[tail++] = nb;
    }
  }
  return DIR_NONE;
}
