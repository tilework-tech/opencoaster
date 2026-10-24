import { TICK_MS } from '../src/sim/core/constants';
import { nearestRankPercentile, withinBudget } from './stats';
import { createBenchScenario } from './scenario';

const BUDGET_MS = 3;

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const guests = arg('guests', 5000);
const ticks = arg('ticks', 400);
const warmup = arg('warmup', 40);
const staff = arg('staff', 100);
const litter = arg('litter', 1000);
const strict = process.argv.includes('--strict');

const sim = createBenchScenario({ guests, staff, litter });

for (let i = 0; i < warmup; i++) sim.step();

const samples = new Float64Array(ticks);
for (let i = 0; i < ticks; i++) {
  const t0 = performance.now();
  sim.step();
  samples[i] = performance.now() - t0;
}
const sorted = Array.from(samples).sort((a, b) => a - b);
const mean = sorted.reduce((a, b) => a + b, 0) / ticks;
const pct = (p: number): number => nearestRankPercentile(sorted, p);
const p99 = pct(0.99);

console.log(
  `entities: ${sim.world.guests.count} guests, ${sim.world.staff.count} staff, ${sim.world.litter.count} litter | ${ticks} ticks`,
);
console.log(
  `ms/tick  mean ${mean.toFixed(3)}  p50 ${pct(0.5).toFixed(3)}  p95 ${pct(0.95).toFixed(3)}  ` +
    `p99 ${pct(0.99).toFixed(3)}  max ${sorted[ticks - 1].toFixed(3)}`,
);
console.log(
  `budget ${BUDGET_MS}ms/tick (tick period ${TICK_MS}ms): ` +
    `${withinBudget(p99, BUDGET_MS) ? 'PASS' : 'OVER'} (p99)`,
);
if (strict && !withinBudget(p99, BUDGET_MS)) process.exit(1);
