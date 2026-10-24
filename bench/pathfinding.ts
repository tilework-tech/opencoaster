import { Prng } from '../src/sim/core/prng';
import { GridPathGraph } from '../src/sim/pathfinding/fixture';
import {
  DEFAULT_GUEST_OPTS,
  DIR_DX,
  DIR_DY,
  DIR_NONE,
  nextDirection,
} from '../src/sim/pathfinding';

const SIZE = 256;
const GRID_STEP = 6;
const rows: string[] = [];
for (let y = 0; y < SIZE; y++) {
  let r = '';
  for (let x = 0; x < SIZE; x++) r += x % GRID_STEP === 0 || y % GRID_STEP === 0 ? '#' : '.';
  rows.push(r);
}
const graph = new GridPathGraph(rows);
const world = { map: graph };
const rng = new Prng(7);
const walkers = 5000;
const ticks = 200;

const pos = new Int32Array(walkers);
const from = new Int8Array(walkers).fill(DIR_NONE);
const target = new Int32Array(walkers);
const pick = (): number =>
  graph.index(rng.int(SIZE / GRID_STEP) * GRID_STEP, rng.int(SIZE / GRID_STEP) * GRID_STEP);
for (let i = 0; i < walkers; i++) {
  pos[i] = pick();
  target[i] = pick();
}
const opts = { ...DEFAULT_GUEST_OPTS, fromDir: DIR_NONE };

const t0 = performance.now();
for (let t = 0; t < ticks; t++) {
  for (let i = 0; i < walkers; i++) {
    opts.fromDir = from[i];
    const d = nextDirection(world, pos[i], target[i], rng, opts);
    if (d === DIR_NONE) {
      target[i] = pick();
      continue;
    }
    pos[i] += DIR_DX[d] + DIR_DY[d] * SIZE;
    from[i] = d;
    if (pos[i] === target[i]) target[i] = pick();
  }
}
const ms = performance.now() - t0;
console.log(
  `pathfinding: ${walkers} walkers x ${ticks} decisions on ${SIZE}x${SIZE} grid: ` +
    `${ms.toFixed(1)}ms total, ${(ms / ticks).toFixed(3)}ms per all-walker tick`,
);
