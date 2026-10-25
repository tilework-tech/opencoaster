import { Simulation } from '../../src/sim/core/simulation';
import { TICKS_PER_MONTH, TICKS_PER_YEAR } from '../../src/sim/economy/calendar';
import { prepareScenario } from '../../src/sim/scenario/scenario-layout';
import { ScenarioStatus } from '../../src/sim/scenario/scenario';
import { objectiveMetric } from '../../src/sim/scenario/scenario-system';
import type { ScenarioDef } from '../../src/sim/scenario/scenario';
import { ParkBuilder } from './builder';
import { RIDE_CATALOG } from '../../src/sim/rides/ride-types';

/** One scripted playthrough: called once per tick before the simulation steps. */
export interface Strategy {
  /** Runs the strategy's decisions for this tick. */
  step(b: ParkBuilder): void;
}

export type StrategyFactory = (def: ScenarioDef) => Strategy;

export interface RunResult {
  seed: number;
  status: ScenarioStatus;
  /** Tick the objective was judged, or the horizon for open-ended scenarios. */
  tick: number;
  metric: number;
  guests: number;
  rating: number;
  cash: number;
  loan: number;
  parkValue: number;
  rides: number;
}

export interface RunOptions {
  seed: number;
  /** Ticks to simulate for open-ended objectives. */
  horizonTicks?: number;
  /** Called at each month boundary, for tracing a run. */
  onMonth?: (month: number, world: Simulation['world']) => void;
}

export function runScenario(
  def: ScenarioDef,
  factory: StrategyFactory,
  opts: RunOptions,
): RunResult {
  const sim = new Simulation({ seed: opts.seed, width: def.mapWidth, height: def.mapHeight });
  prepareScenario(sim.world, def);
  // The strategy suite isolates park and economy balance from research pacing.
  sim.world.research.unlocked = new Set(Object.keys(RIDE_CATALOG).map(Number));
  const builder = new ParkBuilder(sim, def);
  const strategy = factory(def);
  const world = sim.world;
  const horizon = opts.horizonTicks ?? def.objective.byTick + 1;
  while (world.tick < horizon && world.scenario.status === ScenarioStatus.Active) {
    strategy.step(builder);
    sim.step();
    if (opts.onMonth && world.tick % TICKS_PER_MONTH === 0)
      opts.onMonth(world.tick / TICKS_PER_MONTH, world);
  }
  const l = world.economy;
  return {
    seed: opts.seed,
    status: world.scenario.status,
    tick: world.tick,
    metric: world.scenario.objective ? objectiveMetric(world, world.scenario.objective) : 0,
    guests: world.guests.count,
    rating: l.parkRating,
    cash: l.cash,
    loan: l.loan,
    parkValue: l.parkValue,
    rides: world.rides.count,
  };
}

export { TICKS_PER_MONTH, TICKS_PER_YEAR };
