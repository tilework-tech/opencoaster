if (process.argv.includes('--scenario') || process.argv.includes('--child')) {
  await import('./scenario-balance');
  process.exit(0);
}
import { createBalancePark, TICKS_PER_YEAR } from './balance-park';
import type { BalanceProfile } from './balance-park';
import { TICKS_PER_MONTH } from '../src/sim/economy/calendar';
import { LedgerCategory } from '../src/sim/economy/ledger';
import { RIDE_CATALOG } from '../src/sim/rides/ride-types';
import type { RideType } from '../src/sim/rides/ride-types';
import { GuestThought } from '../src/sim/guests/guest-store';
import { ScenarioStatus } from '../src/sim/scenario/scenario';
import { objectiveMetric } from '../src/sim/scenario/scenario-system';
import type { Simulation } from '../src/sim/core/simulation';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const THOUGHT_NAMES = [
  'none',
  'hungry',
  'thirsty',
  'needsToilet',
  'tooNauseous',
  'tooIntense',
  'rideEnjoyed',
  'queueTooLong',
  'leaving',
];

const ticks = arg('ticks', TICKS_PER_YEAR);
const seed = arg('seed', 0);

const profileArg = process.argv.indexOf('--profile');
const profile = (profileArg >= 0 ? process.argv[profileArg + 1] : 'modest') as BalanceProfile;
if (!['minimal', 'modest', 'ambitious'].includes(profile)) {
  throw new Error(`unknown profile ${profile}; use minimal, modest or ambitious`);
}
const park = createBalancePark({ seed: seed || undefined, profile });
const sim = park.sim;
const world = sim.world;
const fee = Math.max(1, world.economy.admissionPrice);

function thoughtHistogram(s: Simulation): number[] {
  const g = s.world.guests.cols;
  const counts = new Array<number>(THOUGHT_NAMES.length).fill(0);
  for (let i = 0; i < s.world.guests.count; i++) {
    counts[g.thought0[i]]++;
    counts[g.thought1[i]]++;
    counts[g.thought2[i]]++;
    counts[g.thought3[i]]++;
  }
  counts[GuestThought.None] = 0;
  return counts;
}

function averages(s: Simulation): { happiness: number; hunger: number; thirst: number } {
  const g = s.world.guests.cols;
  const n = Math.max(1, s.world.guests.count);
  let happiness = 0;
  let hunger = 0;
  let thirst = 0;
  for (let i = 0; i < s.world.guests.count; i++) {
    happiness += g.happiness[i];
    hunger += g.hunger[i];
    thirst += g.thirst[i];
  }
  return {
    happiness: Math.round(happiness / n),
    hunger: Math.round(hunger / n),
    thirst: Math.round(thirst / n),
  };
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

const ledgerTotals = new Array<number>(LedgerCategory.COUNT).fill(0);
const histogramTotal = new Array<number>(THOUGHT_NAMES.length).fill(0);
let arrivedBefore = 0;
let peakGuests = 0;
let ratingMax = 0;
let ratingMin = 1000;

console.log(
  `balance: scenario starter, ${profile} build, seed ${seed || 'scenario'}, ${ticks} ticks ` +
    `(${(ticks / TICKS_PER_MONTH).toFixed(1)} months)`,
);
console.log(
  `${pad('month', 5)} ${pad('guests', 6)} ${pad('arrived', 7)} ${pad('rating', 6)} ` +
    `${pad('cash', 9)} ${pad('value', 8)} ${pad('rides', 5)} ${pad('litter', 6)} ${pad('unhappy%', 8)} ${pad('lost', 4)} ${pad('down%', 5)} ${pad('happy', 5)} ${pad('hungry', 6)} ${pad('thirst', 6)}`,
);

for (let t = 0; t < ticks; t++) {
  park.runSchedule();
  sim.step();
  const l = world.economy;
  if (world.tick > TICKS_PER_MONTH) {
    ratingMax = Math.max(ratingMax, l.parkRating);
    ratingMin = Math.min(ratingMin, l.parkRating);
  }
  peakGuests = Math.max(peakGuests, world.guests.count);
  if (world.tick % TICKS_PER_MONTH === 0) {
    const admission = l.history[l.historyHead * LedgerCategory.COUNT + LedgerCategory.Admission];
    const arrivals = Math.round(admission / fee);
    arrivedBefore += arrivals;
    for (let c = 0; c < LedgerCategory.COUNT; c++) {
      ledgerTotals[c] += l.history[l.historyHead * LedgerCategory.COUNT + c];
    }
    const month = world.tick / TICKS_PER_MONTH;
    const avg = averages(sim);
    console.log(
      `${pad(month, 5)} ${pad(world.guests.count, 6)} ${pad(arrivals, 7)} ${pad(l.parkRating, 6)} ` +
        `${pad((l.cash / 100).toFixed(0), 9)} ${pad((l.parkValue / 100).toFixed(0), 8)} ` +
        `${pad(world.rides.count, 5)} ${pad(world.litter.count, 6)} ${pad(l.inputs.unhappyPercent, 8)} ` +
        `${pad(l.inputs.lostGuests, 4)} ${pad(l.inputs.rideDowntimePercent, 5)} ` +
        `${pad(avg.happiness, 5)} ${pad(avg.hunger, 6)} ${pad(avg.thirst, 6)}`,
    );
    const hist = thoughtHistogram(sim);
    for (let i = 0; i < hist.length; i++) histogramTotal[i] += hist[i];
  }
}

console.log('\nride usage');
console.log(
  `${pad('ride', 22)} ${pad('state', 6)} ${pad('exc', 5)} ${pad('int', 5)} ${pad('nau', 5)} ` +
    `${pad('served', 7)} ${pad('queue', 5)} ${pad('cycles', 6)} ${pad('rel%', 5)} ${pad('broke', 5)} ${pad('down', 6)}`,
);
const r = world.rides.cols;
for (let slot = 0; slot < world.rides.count; slot++) {
  const name = RIDE_CATALOG[r.typeId[slot] as RideType].name;
  console.log(
    `${pad(name, 22)} ${pad(r.state[slot], 6)} ${pad((r.excitement[slot] / 100).toFixed(2), 5)} ` +
      `${pad((r.intensity[slot] / 100).toFixed(2), 5)} ${pad((r.nausea[slot] / 100).toFixed(2), 5)} ` +
      `${pad(r.guestsServed[slot], 7)} ${pad(r.queueLength[slot], 5)} ${pad(r.cyclesCompleted[slot], 6)} ` +
      `${pad(r.reliability[slot], 5)} ${pad(r.breakdownCounter[slot], 5)} ${pad(r.downtimeTicks[slot], 6)}`,
  );
}

console.log('\nthoughts (summed over month-end samples)');
for (let i = 1; i < THOUGHT_NAMES.length; i++) {
  console.log(`${pad(THOUGHT_NAMES[i], 14)} ${pad(histogramTotal[i], 7)}`);
}

const objective = world.scenario.objective;
console.log('\nfinance (whole run, dollars)');
for (let c = 0; c < LedgerCategory.COUNT; c++) {
  if (ledgerTotals[c] !== 0) {
    console.log(`${pad(LedgerCategory[c], 16)} ${pad((ledgerTotals[c] / 100).toFixed(0), 8)}`);
  }
}
console.log('\nsummary');
console.log(`guests arrived: ${arrivedBefore}  peak guests: ${peakGuests}`);
console.log(`rating range after month 1: ${ratingMin}..${ratingMax}`);
if (objective) {
  console.log(
    `objective: ${objectiveMetric(world, objective)} guests (target ${objective.target}), ` +
      `rating ${world.economy.parkRating} (target ${objective.rating}), ` +
      `status ${ScenarioStatus[world.scenario.status]}`,
  );
}
