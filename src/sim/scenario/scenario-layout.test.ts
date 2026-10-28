import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { World } from '../core/world';
import { hashWorld } from '../core/hash';
import { OWNED, SALE_LAND, SALE_RIGHTS, Surface } from '../map/tile-map';
import { layOutEntrance, prepareScenario } from './scenario-layout';
import { ScenarioStatus } from './scenario';
import type { ScenarioDef } from './scenario';

function pathTiles(world: World): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const m = world.map;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (m.surface[m.index(x, y)] === Surface.Path) out.push([x, y]);
    }
  }
  return out;
}

function def(overrides: Partial<ScenarioDef> = {}): ScenarioDef {
  return {
    id: 'layout',
    name: 'Layout',
    seed: 42,
    mapWidth: 64,
    mapHeight: 64,
    startingCash: 5_000_000,
    startingLoan: 0,
    maxLoan: 0,
    annualInterestBps: 0,
    averageGuestCashCents: 5_000,
    difficultRating: false,
    priceMode: 0,
    admissionPrice: 0,
    availableItemIds: [],
    inventions: [],
    entrance: { side: 'south', length: 4 },
    objective: { kind: 0, target: 1, rating: 0, categoryMask: 0, byTick: 512 },
    ...overrides,
  };
}

describe('scenario entrance layout', () => {
  it('lays a straight path inward from the owned south edge, on owned land', () => {
    const world = new World({ seed: 42, width: 64, height: 64 });
    const placed = layOutEntrance(world, { side: 'south', length: 4 });
    expect(placed).toBe(4);
    const tiles = pathTiles(world);
    expect(tiles).toHaveLength(4);
    const xs = new Set(tiles.map(([x]) => x));
    expect(xs.size).toBe(1);
    const ys = tiles.map(([, y]) => y).sort((a, b) => b - a);
    expect(ys[0] - ys[3]).toBe(3);
    for (const [x, y] of tiles)
      expect(world.map.ownership[world.map.index(x, y)] & OWNED).toBe(OWNED);
    expect(Math.max(...ys)).toBe(64 - (64 >> 2) - 1);
  });

  it('places the same path for the same seed', () => {
    const a = new World({ seed: 42, width: 64, height: 64 });
    const b = new World({ seed: 42, width: 64, height: 64 });
    layOutEntrance(a, { side: 'north', length: 3 });
    layOutEntrance(b, { side: 'north', length: 3 });
    expect(pathTiles(b)).toEqual(pathTiles(a));
  });

  it('places nothing when no owned edge run is flat, dry and empty', () => {
    const world = new World({ seed: 1, width: 16, height: 16 });
    world.map.ownership.fill(SALE_LAND | SALE_RIGHTS);
    expect(layOutEntrance(world, { side: 'east', length: 2 })).toBe(0);
    expect(pathTiles(world)).toHaveLength(0);
  });

  it('never lays a second path over the first', () => {
    const world = new World({ seed: 42, width: 64, height: 64 });
    expect(layOutEntrance(world, { side: 'west', length: 2 })).toBe(2);
    expect(layOutEntrance(world, { side: 'west', length: 2 })).toBe(2);
    const tiles = pathTiles(world);
    expect(new Set(tiles.map(([x, y]) => `${x},${y}`)).size).toBe(4);
  });
});

describe('prepareScenario', () => {
  it('applies finances, objective and the entrance before any tick runs', () => {
    const sim = new Simulation({ seed: 42, width: 64, height: 64 });
    prepareScenario(sim.world, def());
    expect(sim.world.economy.cash).toBe(5_000_000);
    expect(sim.world.scenario.status).toBe(ScenarioStatus.Active);
    expect(pathTiles(sim.world)).toHaveLength(4);
    const gate = sim.world.map.index(sim.world.park.entranceX, sim.world.park.entranceY);
    expect(sim.world.park.entranceY).toBe(sim.world.map.height - (sim.world.map.height >> 2) - 1);
    expect(sim.world.map.isWalkable(gate)).toBe(true);
    expect(sim.world.map.surface[gate]).toBe(Surface.Path);
    sim.enqueue({ type: 'spawnGuests', count: 1 });
    sim.step();
    expect(sim.world.guests.cols.x[0] >> 8).toBe(sim.world.park.entranceX);
    expect(sim.world.guests.cols.y[0] >> 8).toBe(sim.world.park.entranceY);
  });

  it('is deterministic: the same definition gives the same starting world', () => {
    const make = () => {
      const sim = new Simulation({ seed: 42, width: 64, height: 64 });
      prepareScenario(sim.world, def());
      return hashWorld(sim.world);
    };
    expect(make()).toBe(make());
  });

  it('skips the entrance when the definition has none', () => {
    const sim = new Simulation({ seed: 42, width: 64, height: 64 });
    prepareScenario(sim.world, def({ entrance: undefined }));
    expect(pathTiles(sim.world)).toHaveLength(0);
  });
});
