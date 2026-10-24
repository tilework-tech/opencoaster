import { Simulation } from '../src/sim/core/simulation';
import { DEFAULT_MAP_SIZE, TICK_MS } from '../src/sim/core/constants';

const BUDGET_MS = 8;

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const guests = arg('guests', 5000);
const ticks = arg('ticks', 400);
const warmup = arg('warmup', 40);
const strict = process.argv.includes('--strict');

const sim = new Simulation({ seed: 1, width: DEFAULT_MAP_SIZE, height: DEFAULT_MAP_SIZE });
sim.enqueue({ type: 'spawnGuests', count: guests });
sim.enqueue({ type: 'spawnStaff', count: 100, kind: 0 });

for (let i = 0; i < warmup; i++) sim.step();

const samples = new Float64Array(ticks);
for (let i = 0; i < ticks; i++) {
  const t0 = performance.now();
  sim.step();
  samples[i] = performance.now() - t0;
}
const sorted = Array.from(samples).sort((a, b) => a - b);
const mean = sorted.reduce((a, b) => a + b, 0) / ticks;
const pct = (p: number): number => sorted[Math.min(ticks - 1, Math.floor(p * ticks))];

console.log(
  `entities: ${sim.world.guests.count} guests, ${sim.world.staff.count} staff | ${ticks} ticks`,
);
console.log(
  `ms/tick  mean ${mean.toFixed(3)}  p50 ${pct(0.5).toFixed(3)}  p95 ${pct(0.95).toFixed(3)}  ` +
    `p99 ${pct(0.99).toFixed(3)}  max ${sorted[ticks - 1].toFixed(3)}`,
);
console.log(
  `budget ${BUDGET_MS}ms/tick (tick period ${TICK_MS}ms): ` +
    `${pct(0.95) <= BUDGET_MS ? 'PASS' : 'OVER'} (p95)`,
);
if (strict && pct(0.95) > BUDGET_MS) process.exit(1);
