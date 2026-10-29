import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { World } from '../core/world';
import { DEFAULT_MAP_SIZE, TICK_RATE, TILE_UNITS } from '../core/constants';
import { SCENARIOS } from '../scenario/catalog';
import { prepareSandbox } from '../scenario/sandbox';
import { prepareScenarioPark } from '../scenario/scenario-layout';
import { spawnPoints } from './park';
import { spawnGuest } from './guest-store';

const TICKS = TICK_RATE * 60 * 10;

function candidates(): Array<[string, () => World]> {
  return [
    [
      'sandbox',
      () => {
        const w = new World({ seed: 1, width: DEFAULT_MAP_SIZE, height: DEFAULT_MAP_SIZE });
        prepareSandbox(w);
        return w;
      },
    ],
    ...SCENARIOS.map((def): [string, () => World] => [
      def.id,
      () => {
        const w = new World({ seed: def.seed, width: def.mapWidth, height: def.mapHeight });
        prepareScenarioPark(w, def);
        return w;
      },
    ]),
  ];
}

function atSpawn(world: World, slot: number): boolean {
  const x = Math.floor(world.guests.cols.x[slot]! / TILE_UNITS);
  const y = Math.floor(world.guests.cols.y[slot]! / TILE_UNITS);
  return spawnPoints(world).some((p) => p.x === x && p.y === y);
}

describe('guest spawning', () => {
  it.each(candidates())('%s: every new guest appears on a spawn point', (_name, build) => {
    const world = build();
    const sim = new Simulation(world);
    sim.enqueue({ type: 'spawnGuests', count: 5 });
    const seen = new Set<number>();
    let arrivals = 0;
    for (let tick = 0; tick < TICKS; tick++) {
      sim.step();
      for (let slot = 0; slot < world.guests.count; slot++) {
        const id = world.guests.slotToId[slot]!;
        if (seen.has(id)) continue;
        seen.add(id);
        arrivals++;
        expect(atSpawn(world, slot), `guest ${id} at tick ${tick}`).toBe(true);
      }
    }
    expect(arrivals).toBeGreaterThanOrEqual(5);
  });

  it('sandbox guests arrive on their own and walk in through the gate', () => {
    const world = candidates()[0]![1]();
    const sim = new Simulation(world);
    const gate = world.map.index(world.park.entranceX, world.park.entranceY);
    let reachedGate = false;
    for (let tick = 0; tick < TICKS; tick++) {
      sim.step();
      for (let slot = 0; slot < world.guests.count; slot++) {
        const tile = world.map.index(
          Math.floor(world.guests.cols.x[slot]! / TILE_UNITS),
          Math.floor(world.guests.cols.y[slot]! / TILE_UNITS),
        );
        if (tile === gate) reachedGate = true;
      }
    }
    expect(world.guests.count).toBeGreaterThan(0);
    expect(reachedGate).toBe(true);
  });

  it('refuses to spawn when the park has no spawn point or entrance', () => {
    const world = new World({ seed: 1, width: 32, height: 32 });
    expect(spawnGuest(world)).toBe(false);
    expect(world.guests.count).toBe(0);
  });
});
