import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseScenarioFile } from '../src/sim/scenario/scenario-file';
import { ScenarioStatus } from '../src/sim/scenario/scenario';
import type { ScenarioDef } from '../src/sim/scenario/scenario';
import { TICKS_PER_YEAR } from '../src/sim/economy/calendar';
import { objectiveMetric } from '../src/sim/scenario/scenario-system';
import type { Simulation } from '../src/sim/core/simulation';
import { runScenario } from './strategy/run';
import type { RunResult } from './strategy/run';
import { STRATEGIES } from './strategy/strategies';

const SCENARIO_DIR = new URL('../src/sim/scenario/scenarios/', import.meta.url);
/** Years simulated for scenarios with no deadline. */
const OPEN_ENDED_YEARS = 4;

function loadDefs(): ScenarioDef[] {
  return readdirSync(SCENARIO_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => parseScenarioFile(JSON.parse(readFileSync(new URL(f, SCENARIO_DIR), 'utf8'))));
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function seedList(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

/** HaveFun scenarios never end; a run counts as a win when the park is solvent and rated at the horizon. */
export function isWin(def: ScenarioDef, r: RunResult): boolean {
  if (def.objective.byTick === 0) return r.cash >= 0 && r.rating >= 600 && r.guests >= 200;
  return r.status === ScenarioStatus.Won;
}

function runSeeds(def: ScenarioDef, seeds: number[]): RunResult[] {
  const factory = STRATEGIES[def.id];
  if (!factory) throw new Error(`No strategy for scenario ${def.id}`);
  const horizonTicks = def.objective.byTick === 0 ? OPEN_ENDED_YEARS * TICKS_PER_YEAR : undefined;
  const onMonth = process.argv.includes('--trace')
    ? (month: number, w: Simulation['world']) => {
        const l = w.economy;
        console.error(
          `m${month} guests ${w.guests.count} rating ${l.parkRating} cash ${Math.round(l.cash / 100)} loan ${Math.round(l.loan / 100)} value ${Math.round(l.parkValue / 100)} rides ${w.rides.count} litter ${l.inputs.litter} down% ${l.inputs.rideDowntimePercent} metric ${w.scenario.objective ? objectiveMetric(w, w.scenario.objective) : 0}`,
        );
      }
    : undefined;
  return seeds.map((seed) => runScenario(def, factory, { seed, horizonTicks, onMonth }));
}

/** Child mode: run the given seeds for one scenario and print the results as JSON. */
function child(id: string, seeds: number[]): void {
  const def = loadDefs().find((d) => d.id === id);
  if (!def) throw new Error(`Unknown scenario ${id}`);
  console.log(JSON.stringify(runSeeds(def, seeds)));
}

function runInChild(id: string, seeds: number[]): Promise<RunResult[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      [
        ...process.execArgv,
        fileURLToPath(import.meta.url),
        '--child',
        id,
        '--seed-list',
        seeds.join(','),
        ...(process.argv.includes('--trace') ? ['--trace'] : []),
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.on('exit', (code) => {
      if (code !== 0) reject(new Error(`child for ${id} exited ${code}`));
      else resolve(JSON.parse(out.trim().split('\n').pop() as string) as RunResult[]);
    });
  });
}

async function main(): Promise<void> {
  const childId = arg('child');
  if (childId) return child(childId, (arg('seed-list') ?? '1').split(',').map(Number));

  const wanted = arg('scenario') ?? 'all';
  const seeds = seedList(Number(arg('seeds') ?? 12));
  const jobs = Number(arg('jobs') ?? 4);
  const defs = loadDefs().filter(
    (d) => d.id !== 'starter' && (wanted === 'all' || d.id === wanted),
  );
  if (defs.length === 0) throw new Error(`No scenario matches ${wanted}`);

  const rows: string[] = [];
  for (const def of defs) {
    const chunks = Array.from({ length: Math.min(jobs, seeds.length) }, (_, j) =>
      seeds.filter((_, i) => i % Math.min(jobs, seeds.length) === j),
    );
    const results = (await Promise.all(chunks.map((c) => runInChild(def.id, c))))
      .flat()
      .sort((a, b) => a.seed - b.seed);
    const wins = results.filter((r) => isWin(def, r)).length;
    rows.push(`| ${def.id} | ${def.category} | ${wins}/${seeds.length} |`);
    console.log(`\n${def.id} (${def.category}): ${wins}/${seeds.length} won`);
    for (const r of results) {
      console.log(
        `  seed ${String(r.seed).padStart(2)} ${isWin(def, r) ? 'WIN ' : 'lose'} tick ${r.tick} metric ${r.metric} guests ${r.guests} rating ${r.rating} cash ${Math.round(r.cash / 100)} loan ${Math.round(r.loan / 100)} value ${Math.round(r.parkValue / 100)} rides ${r.rides}`,
      );
    }
  }
  console.log(`\n| scenario | tab | wins |\n| --- | --- | --- |\n${rows.join('\n')}`);
}

await main();
