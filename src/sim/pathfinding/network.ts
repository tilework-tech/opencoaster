import type { PathGraph } from './graph';
import { nodeCount, stepNode } from './graph';
import { oppositeDir, popcount4 } from './directions';

const UNCOMPUTED = -2;
const NO_END = -1;
export const QUEUE_CAP = 2048;

/**
 * Cached, derived view of a path graph: corridor links between junction/dead-end tiles and
 * connected-component labels. Also owns the typed-array scratch used by the searches, so queries
 * never allocate. It is a pure function of the graph and is rebuilt when `pathVersion` changes;
 * it is not part of world state.
 */
export class PathNetwork {
  readonly size: number;
  private version = -1;

  /** Per (tile, dir): tile where the corridor starting with that step ends, or NO_END. */
  readonly linkEnd: Int32Array;
  readonly linkLen: Int32Array;
  /** Direction of the last step into `linkEnd`. */
  readonly linkArr: Uint8Array;

  readonly comp: Int32Array;
  /** 1 for a node with exits that no neighbour leads back to (a ride exit); it shares its exit's component. */
  private readonly sourceOnly: Uint8Array;
  private compValid = false;

  readonly stamp: Int32Array;
  private gen = 0;
  /** Tile-level BFS scratch. */
  readonly tileQueue: Int32Array;
  readonly tileFirst: Uint8Array;
  /** Junction-level search scratch. */
  readonly qNode = new Int32Array(QUEUE_CAP);
  readonly qArr = new Uint8Array(QUEUE_CAP);
  readonly qFirst = new Uint8Array(QUEUE_CAP);
  readonly qSteps = new Int32Array(QUEUE_CAP);
  readonly qCost = new Uint8Array(QUEUE_CAP);

  /** Outputs of `walk`. */
  walkEnd = NO_END;
  walkLen = 0;
  walkArr = 0;
  /** Steps from the walk start to the target if it lay on the corridor, else -1. */
  walkHit = -1;

  constructor(readonly graph: PathGraph) {
    const n = nodeCount(graph);
    this.size = n;
    this.linkEnd = new Int32Array(n * 4).fill(UNCOMPUTED);
    this.linkLen = new Int32Array(n * 4);
    this.linkArr = new Uint8Array(n * 4);
    this.comp = new Int32Array(n);
    this.sourceOnly = new Uint8Array(n);
    this.stamp = new Int32Array(n);
    this.tileQueue = new Int32Array(n);
    this.tileFirst = new Uint8Array(n);
  }

  /** Drops cached data if the graph was edited since the last call. */
  sync(): void {
    const v = this.graph.pathVersion;
    if (v === this.version) return;
    this.version = v;
    this.linkEnd.fill(UNCOMPUTED);
    this.compValid = false;
  }

  /** Starts a fresh visited set; `stamp[t] === returned value` means visited. */
  newVisitSet(): number {
    if (++this.gen === 0x7fffffff) {
      this.stamp.fill(0);
      this.gen = 1;
    }
    return this.gen;
  }

  /**
   * Follows the corridor from `start` in `dir` through tiles with exactly two exits until a
   * junction or dead end. Sets walkEnd/walkLen/walkArr (walkEnd = -1 for a closed loop) and, when
   * `target >= 0` lies on the corridor, walkHit.
   */
  walk(start: number, dir: number, target: number): void {
    const g = this.graph;
    let t = start;
    let d = dir;
    let len = 0;
    this.walkHit = -1;
    for (;;) {
      t = stepNode(g, t, d);
      len++;
      if (t === target) this.walkHit = len;
      const m = g.edgeMask(t);
      if (popcount4(m) !== 2 || (m & (1 << oppositeDir(d))) === 0) break;
      const rest = m & ~(1 << oppositeDir(d));
      d = rest === 1 ? 0 : rest === 2 ? 1 : rest === 4 ? 2 : 3;
      if (t === start || len > this.size) {
        this.walkEnd = NO_END;
        this.walkLen = len;
        this.walkArr = d;
        return;
      }
    }
    this.walkEnd = t;
    this.walkLen = len;
    this.walkArr = d;
  }

  /** Cached `walk` without target detection. Returns the end tile or -1. */
  link(tile: number, dir: number): number {
    const k = tile * 4 + dir;
    let e = this.linkEnd[k];
    if (e === UNCOMPUTED) {
      this.walk(tile, dir, -1);
      e = this.walkEnd;
      this.linkEnd[k] = e;
      this.linkLen[k] = this.walkLen;
      this.linkArr[k] = this.walkArr;
    }
    return e;
  }

  /** Connected-component id of a tile (0 for non-path tiles). */
  component(tile: number): number {
    if (!this.compValid) this.labelComponents();
    return this.comp[tile];
  }

  /** True when walkers can leave `node` but never enter it. */
  isSourceOnly(node: number): boolean {
    if (!this.compValid) this.labelComponents();
    return this.sourceOnly[node] === 1;
  }

  private labelComponents(): void {
    const { comp, tileQueue: q, graph: g } = this;
    comp.fill(0);
    this.sourceOnly.fill(0);
    let id = 0;
    for (let s = 0; s < this.size; s++) {
      if (comp[s] !== 0 || g.edgeMask(s) === 0) continue;
      id++;
      let head = 0;
      let tail = 0;
      q[tail++] = s;
      comp[s] = id;
      while (head < tail) {
        const t = q[head++];
        const m = g.edgeMask(t);
        for (let d = 0; d < 4; d++) {
          if ((m & (1 << d)) === 0) continue;
          const nb = stepNode(g, t, d);
          if (comp[nb] === 0) {
            comp[nb] = id;
            q[tail++] = nb;
          }
        }
      }
    }
    // A node with exits that nothing leads back to (a ride exit) belongs to the component it feeds.
    for (let s = 0; s < this.size; s++) {
      const m = g.edgeMask(s);
      if (m === 0) continue;
      const d = m & 1 ? 0 : m & 2 ? 1 : m & 4 ? 2 : 3;
      const nb = stepNode(g, s, d);
      if ((g.edgeMask(nb) & (1 << oppositeDir(d))) !== 0) continue;
      comp[s] = comp[nb];
      this.sourceOnly[s] = 1;
    }
    this.compValid = true;
  }
}

const networks = new WeakMap<PathGraph, PathNetwork>();

export function networkFor(graph: PathGraph): PathNetwork {
  let n = networks.get(graph);
  if (!n) {
    n = new PathNetwork(graph);
    networks.set(graph, n);
  }
  n.sync();
  return n;
}
