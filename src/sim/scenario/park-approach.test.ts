import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { DEFAULT_MAP_SIZE } from '../core/constants';
import { spawnPoints } from '../guests/park';
import { OWNED } from '../map/tile-map';
import { SCENARIOS } from './catalog';
import { prepareSandbox } from './sandbox';
import { prepareScenarioPark } from './scenario-layout';
import { ownedBounds } from './scenario-map';

function sandbox(seed = 1): World {
  const world = new World({ seed, width: DEFAULT_MAP_SIZE, height: DEFAULT_MAP_SIZE });
  prepareSandbox(world);
  return world;
}

function scenarioWorld(id: string): World {
  const def = SCENARIOS.find((s) => s.id === id)!;
  const world = new World({ seed: def.seed, width: def.mapWidth, height: def.mapHeight });
  prepareScenarioPark(world, def);
  return world;
}

function pathConnected(world: World, from: number, to: number): boolean {
  const m = world.map;
  const seen = new Set<number>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const i = queue.pop()!;
    if (i === to) return true;
    const x = i % m.width;
    const y = Math.floor(i / m.width);
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as const) {
      if (!m.inBounds(nx, ny)) continue;
      const n = m.index(nx, ny);
      if (!seen.has(n) && m.isWalkable(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return false;
}

function onMapEdge(world: World, x: number, y: number): boolean {
  const m = world.map;
  return x === 0 || y === 0 || x === m.width - 1 || y === m.height - 1;
}

function expectApproach(world: World): void {
  const { park, map } = world;
  expect(park.entranceX).toBeGreaterThanOrEqual(0);
  const spawns = spawnPoints(world);
  expect(spawns.length).toBeGreaterThan(0);
  for (const spawn of spawns) {
    expect(onMapEdge(world, spawn.x, spawn.y)).toBe(true);
    expect(map.isWalkable(map.index(spawn.x, spawn.y))).toBe(true);
    expect(
      pathConnected(world, map.index(spawn.x, spawn.y), map.index(park.entranceX, park.entranceY)),
    ).toBe(true);
  }
  expect(map.ownership[map.index(park.entranceX, park.entranceY)] & OWNED).toBe(OWNED);
}

describe('sandbox park approach', () => {
  it('has an entrance on the owned edge and a spawn on the map edge joined by a path', () => {
    expectApproach(sandbox());
  });

  it('has an entrance path leading from the gate into owned land', () => {
    const world = sandbox();
    const { map, park } = world;
    const owned = ownedBounds(map.width, map.height, {
      ownedMarginPercent: 25,
      saleMarginPercent: 0,
    });
    const inside = [
      [park.entranceX + 1, park.entranceY],
      [park.entranceX - 1, park.entranceY],
      [park.entranceX, park.entranceY + 1],
      [park.entranceX, park.entranceY - 1],
    ].filter(
      ([x, y]) =>
        x! >= owned.x0 &&
        x! <= owned.x1 &&
        y! >= owned.y0 &&
        y! <= owned.y1 &&
        map.isWalkable(map.index(x!, y!)),
    );
    expect(inside.length).toBeGreaterThan(0);
  });

  it('builds the approach for several terrain seeds', () => {
    for (const seed of [1, 2, 3, 7, 99, 1234]) expectApproach(sandbox(seed));
  });
});

describe('scenario park approach', () => {
  it.each(SCENARIOS.map((s) => s.id))('%s has a reachable spawn on the map edge', (id) => {
    expectApproach(scenarioWorld(id));
  });
});
