import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_MONTH } from '../src/sim/economy/calendar';
import { parseScenarioFile } from '../src/sim/scenario/scenario-file';
import { ObjectiveKind } from '../src/sim/scenario/scenario';
import { RideState } from '../src/sim/rides/ride-store';
import { runScenario } from './strategy/run';
import { STRATEGIES } from './strategy/strategies';

const TIMEOUT_MS = 60_000;

const dir = new URL('../src/sim/scenario/scenarios/', import.meta.url);
const defs = readdirSync(dir)
  .filter((f) => f.endsWith('.json') && f !== 'starter.json')
  .map((f) => parseScenarioFile(JSON.parse(readFileSync(new URL(f, dir), 'utf8'))));

describe('scenario strategies', () => {
  it('has a scripted strategy for every shipped scenario', () => {
    for (const def of defs) expect(STRATEGIES[def.id], def.id).toBeDefined();
  });

  for (const def of defs) {
    it(
      `${def.id}: the script builds and opens a working park`,
      () => {
        const result = runScenario(def, STRATEGIES[def.id], {
          seed: 1,
          horizonTicks: 2 * TICKS_PER_MONTH,
        });
        expect(result.rides).toBeGreaterThanOrEqual(4);
        expect(result.guests).toBeGreaterThan(20);
      },
      TIMEOUT_MS,
    );
  }

  it(
    'opens every ride the script places, coasters included, within three months',
    () => {
      const def = defs.find((d) => d.objective.kind === ObjectiveKind.CompleteCoasters);
      if (!def) throw new Error('no coaster scenario');
      let open = 0;
      let total = 0;
      runScenario(def, STRATEGIES[def.id], {
        seed: 1,
        horizonTicks: 3 * TICKS_PER_MONTH,
        onMonth: (month, world) => {
          if (month !== 3) return;
          total = world.rides.count;
          for (let s = 0; s < world.rides.count; s++) {
            if (world.rides.cols.state[s] === RideState.Open) open++;
          }
        },
      });
      expect(total).toBeGreaterThan(0);
      expect(open).toBe(total);
    },
    TIMEOUT_MS,
  );
});
