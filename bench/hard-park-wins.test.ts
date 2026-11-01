import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serialize } from '../src/save/save';
import { Simulation } from '../src/sim/core/simulation';
import { TICKS_PER_MONTH } from '../src/sim/economy/calendar';
import { rideQueueCapacity } from '../src/sim/rides/ride-operations';
import { RideState } from '../src/sim/rides/ride-store';
import { RIDE_CATALOG } from '../src/sim/rides/ride-types';
import type { RideType } from '../src/sim/rides/ride-types';
import { SCENARIOS } from '../src/sim/scenario/catalog';
import { ScenarioStatus } from '../src/sim/scenario/scenario';
import { prepareScenarioPark } from '../src/sim/scenario/scenario-layout';
import { runScenario } from './strategy/run';
import { STRATEGIES } from './strategy/strategies';

/**
 * Plays Tidewater Docks and Thunderhead Mesa to their deadlines on the map a new game generates
 * (the scenario's own seed), with the scenario's own research, cash and loan, and only the
 * commands a player issues. Each must end in a win. With HARD_PROOF_SAVES set, the won park is
 * saved there for the browser screenshots.
 */

const TIMEOUT_MS = 300_000;

const QUEUED_CATEGORIES = new Set(['gentle', 'thrill', 'coaster', 'water', 'transport']);

/** Tile the browser proof centres on: a busy part of each won park. */
const FOCUS: Record<string, readonly [number, number]> = {
  'tidewater-docks': [16, 47],
  'thunderhead-mesa': [46, 16],
};

function startingResearch(id: string): number[] {
  const def = SCENARIOS.find((s) => s.id === id)!;
  const sim = new Simulation({ seed: def.seed, width: def.mapWidth, height: def.mapHeight });
  prepareScenarioPark(sim.world, def);
  return [...sim.world.research.unlocked].sort((a, b) => a - b);
}

for (const id of ['tidewater-docks', 'thunderhead-mesa']) {
  describe(id, () => {
    const def = SCENARIOS.find((s) => s.id === id)!;

    it(
      'wins on the new-game map with the scenario research, its rides open and queueing',
      () => {
        let research: number[] = [];
        const shortQueues: string[] = [];
        const unopened: string[] = [];
        let finalWorld: Simulation['world'] | null = null;
        const result = runScenario(def, STRATEGIES[id], {
          seed: def.seed,
          realResearch: true,
          onMonth: (month, world) => {
            if (month === 1) research = [...world.research.unlocked].sort((a, b) => a - b);
            finalWorld = world;
            if (month !== 12) return;
            const rides = world.rides.cols;
            for (let slot = 0; slot < world.rides.count; slot++) {
              const ride = RIDE_CATALOG[rides.typeId[slot] as RideType];
              const where = `${ride.name} at ${rides.rideX[slot]},${rides.rideY[slot]}`;
              const state = rides.state[slot];
              if (state !== RideState.Open && state !== RideState.Broken) unopened.push(where);
              if (QUEUED_CATEGORIES.has(ride.category) && rideQueueCapacity(world, slot) <= 4)
                shortQueues.push(where);
            }
          },
        });

        const dir = process.env.HARD_PROOF_SAVES;
        if (dir && finalWorld) {
          const world: Simulation['world'] = finalWorld;
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, `${id}-won.ocsave`), serialize(world));
          const [x, y] = FOCUS[id];
          const z = world.map.heights[world.map.index(x, y)];
          writeFileSync(join(dir, `${id}-won.json`), JSON.stringify({ focus: [x, y, z] }));
        }

        expect(research, 'starts from the scenario research').toEqual(
          expect.arrayContaining(startingResearch(id)),
        );
        expect(research.length, 'the catalog is not unlocked up front').toBeLessThan(
          Object.keys(RIDE_CATALOG).length,
        );
        expect.soft(unopened, 'every ride placed in the first year opens').toEqual([]);
        expect.soft(shortQueues, 'rides have room to queue').toEqual([]);
        expect(result.status, JSON.stringify(result)).toBe(ScenarioStatus.Won);
        expect(result.tick).toBeGreaterThanOrEqual(def.objective.byTick);
        expect(result.tick).toBeLessThan(def.objective.byTick + TICKS_PER_MONTH);
      },
      TIMEOUT_MS,
    );
  });
}
