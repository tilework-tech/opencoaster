import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { hashWorld } from '../core/hash';
import { ElementType, OWNED, SALE_LAND, SALE_RIGHTS, Surface } from '../map/tile-map';
import { SceneryItem } from '../map/scenery';
import { RideState } from '../rides/ride-store';
import { TILE_UNITS, Z_STEP } from '../core/constants';
import { project } from '../../render/projection';
import { SCENARIOS } from './catalog';
import { buildApron, generateScenarioMap, ownedBounds } from './scenario-map';
import { parseScenarioFile } from './scenario-file';
import { prepareScenario } from './scenario-layout';
import type { ScenarioDef } from './scenario';

function recipe(overrides: Record<string, unknown> = {}): ScenarioDef {
  return parseScenarioFile({
    id: 'map-test',
    name: 'Map Test',
    seed: 7,
    map: { width: 80, height: 80 },
    finance: {
      startingCash: 4_000_000,
      startingLoan: 1_000_000,
      maxLoan: 5_000_000,
      annualInterestBps: 800,
    },
    pricing: { mode: 'admission', admissionPrice: 300 },
    entrance: { side: 'south', length: 4 },
    terrain: {
      seaLevel: 3,
      baseLevel: 5,
      relief: 6,
      cell: 8,
      buildLevel: 6,
      buildLength: 30,
      buildWidth: 21,
      lakes: [{ x: 25, y: 35, rx: 9, ry: 7, depth: 3 }],
      hills: [{ x: 75, y: 30, radius: 10, height: 4 }],
    },
    trees: { count: 80, groves: 5 },
    objective: { kind: 'guests', target: 50, byYear: 1 },
    ...overrides,
  });
}

function world(def: ScenarioDef, seed = def.seed): World {
  const w = new World({ seed, width: def.mapWidth, height: def.mapHeight });
  prepareScenario(w, def);
  return w;
}

function scenarioMap(def: ScenarioDef, seed = def.seed): World {
  const w = new World({ seed, width: def.mapWidth, height: def.mapHeight });
  generateScenarioMap(w.map, def, w.seed);
  return w;
}

describe('scenario terrain generation', () => {
  it('is deterministic for a seed and varies between seeds', () => {
    const def = recipe();
    expect(hashWorld(world(def, 11))).toBe(hashWorld(world(def, 11)));
    expect(hashWorld(world(def, 11))).not.toBe(hashWorld(world(def, 12)));
  });

  it('keeps the build apron flat, dry, owned and free of scenery for any seed', () => {
    const def = recipe();
    const apron = buildApron(80, 80, 'south', def.terrain!);
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = world(def, seed).map;
      for (let y = apron.y0; y <= apron.y1; y++) {
        for (let x = apron.x0; x <= apron.x1; x++) {
          const i = m.index(x, y);
          expect(m.heights[i]).toBe(def.terrain!.buildLevel);
          expect(m.slope[i]).toBe(0);
          expect(m.waterLevel[i]).toBe(0);
          expect(m.ownership[i] & OWNED).toBe(OWNED);
          const onPath = m.surface[i] === Surface.Path;
          expect(onPath || m.firstElement(i) < 0).toBe(true);
        }
      }
    }
  });

  it('has water, rises and trees, and every tile spans at most one level', () => {
    const m = world(recipe()).map;
    let water = 0;
    let trees = 0;
    let high = 0;
    for (let i = 0; i < m.width * m.height; i++) {
      if (m.waterLevel[i] > m.heights[i]) water++;
      if (m.heights[i] > 8) high++;
      for (let e = m.firstElement(i); e >= 0; e = m.nextElement(e)) {
        if (m.elType[e] === ElementType.SmallScenery) trees++;
      }
    }
    expect(water).toBeGreaterThan(40);
    expect(high).toBeGreaterThan(20);
    expect(trees).toBeGreaterThan(40);
  });

  it('owns an inset rectangle and sells the rest up to the unsellable margin', () => {
    const def = recipe({ land: { ownedMarginPercent: 20, saleMarginPercent: 5 } });
    const m = scenarioMap(def).map;
    const o = ownedBounds(80, 80, def.land);
    expect(o).toEqual({ x0: 16, y0: 16, x1: 63, y1: 63 });
    expect(m.ownership[m.index(40, 40)] & OWNED).toBe(OWNED);
    expect(m.ownership[m.index(15, 40)] & SALE_LAND).toBe(SALE_LAND);
    expect(m.ownership[m.index(15, 40)] & SALE_RIGHTS).toBe(0);
    expect(m.ownership[m.index(10, 40)] & SALE_RIGHTS).toBe(SALE_RIGHTS);
    expect(m.ownership[m.index(10, 40)] & SALE_LAND).toBe(0);
    expect(m.ownership[m.index(2, 40)]).toBe(0);
  });

  it('puts the gate at the apron middle on every side', () => {
    for (const side of ['north', 'east', 'south', 'west']) {
      const def = recipe({ entrance: { side, length: 4 } });
      const w = world(def);
      expect(w.park.entranceX).toBeGreaterThanOrEqual(0);
      const apron = buildApron(80, 80, side as 'north', def.terrain!);
      expect(w.park.entranceX).toBeGreaterThanOrEqual(apron.x0);
      expect(w.park.entranceX).toBeLessThanOrEqual(apron.x1);
      expect(w.park.entranceY).toBeGreaterThanOrEqual(apron.y0);
      expect(w.park.entranceY).toBeLessThanOrEqual(apron.y1);
    }
  });
});

describe('scenario ground and trees', () => {
  const trees = (m: World['map']): Array<{ x: number; y: number; item: number }> => {
    const found: Array<{ x: number; y: number; item: number }> = [];
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const i = m.index(x, y);
        for (let e = m.firstElement(i); e >= 0; e = m.nextElement(e)) {
          if (m.elType[e] === ElementType.SmallScenery) found.push({ x, y, item: m.elData[e] });
        }
      }
    }
    return found;
  };

  const steep = (m: World['map'], x: number, y: number): boolean => {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (!m.inBounds(x + dx, y + dy)) continue;
        if (Math.abs(m.heights[m.index(x + dx, y + dy)] - m.heights[m.index(x, y)]) >= 3)
          return true;
      }
    }
    return false;
  };

  it('gives Starter Park a broad flat owned apron with varied terrain beyond it', () => {
    const starter = SCENARIOS.find((scenario) => scenario.id === 'starter');
    expect(starter?.terrain).toBeDefined();
    expect(starter?.entrance).toBeDefined();
    if (!starter?.terrain || !starter.entrance) return;

    const m = world(starter).map;
    const apron = buildApron(
      m.width,
      m.height,
      starter.entrance.side,
      starter.terrain,
      starter.land,
    );
    expect(apron.x1 - apron.x0 + 1).toBe(30);
    expect(apron.y1 - apron.y0 + 1).toBe(20);
    const apronArea = (apron.x1 - apron.x0 + 1) * (apron.y1 - apron.y0 + 1);
    expect(apronArea).toBe(600);

    for (let y = apron.y0; y <= apron.y1; y++) {
      for (let x = apron.x0; x <= apron.x1; x++) {
        const i = m.index(x, y);
        expect(m.heights[i]).toBe(starter.terrain.buildLevel);
        expect(m.slope[i]).toBe(0);
        expect(m.waterLevel[i]).toBe(0);
        expect(m.ownership[i] & OWNED).toBe(OWNED);
        for (let e = m.firstElement(i); e >= 0; e = m.nextElement(e)) {
          expect(m.elType[e]).toBe(ElementType.Path);
        }
      }
    }

    const beyondApron = Array.from({ length: m.width * m.height }, (_, i) => i).filter((i) => {
      const x = i % m.width;
      const y = Math.floor(i / m.width);
      return x < apron.x0 - 4 || x > apron.x1 + 4 || y < apron.y0 - 4 || y > apron.y1 + 4;
    });
    expect(beyondApron.some((i) => m.waterLevel[i] > m.heights[i])).toBe(true);
    expect(beyondApron.some((i) => m.heights[i] > starter.terrain!.buildLevel)).toBe(true);
  });

  it('keeps grass-themed ground grass, with rock only on steep faces', () => {
    const def = recipe({
      trees: undefined,
      terrain: { ...recipe().terrain!, relief: 12, cell: 5 },
    });
    for (const seed of [1, 2, 3]) {
      const m = world(def, seed).map;
      let rock = 0;
      for (let y = 0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
          const surface = m.terrain[m.index(x, y)];
          expect([Surface.Grass, Surface.Rock]).toContain(surface);
          if (surface === Surface.Rock) {
            rock++;
            expect(steep(m, x, y)).toBe(true);
          }
        }
      }
      expect(rock).toBeGreaterThan(0);
    }
  });

  it('paints ground at or above the highland level with the highland surface', () => {
    const def = recipe({
      terrain: { ...recipe().terrain!, highland: { surface: 'dirt', level: 7 } },
    });
    const m = scenarioMap(def).map;
    let upland = 0;
    for (let i = 0; i < m.width * m.height; i++) {
      if (m.heights[i] >= 7) {
        upland++;
        expect(m.terrain[i]).toBe(Surface.Dirt);
      } else if (m.terrain[i] !== Surface.Rock) {
        expect(m.terrain[i]).toBe(Surface.Grass);
      }
    }
    expect(upland).toBeGreaterThan(0);
  });

  it('places only the listed species, on sand, and never on rock or water', () => {
    const def = recipe({
      terrain: { ...recipe().terrain!, surface: 'sand' },
      trees: { count: 60, groves: 4, species: ['palm'] },
    });
    const m = scenarioMap(def).map;
    const placed = trees(m);
    expect(placed.length).toBe(60);
    for (const t of placed) {
      expect(t.item).toBe(SceneryItem.PalmTree);
      const i = m.index(t.x, t.y);
      expect(m.terrain[i]).toBe(Surface.Sand);
      expect(m.waterLevel[i]).toBe(0);
    }
  });

  it('places the configured count in mixed species on grass, clear of the gate margin', () => {
    const def = recipe({ trees: { count: 90, groves: 6 } });
    const m = scenarioMap(def).map;
    const apron = buildApron(80, 80, 'south', def.terrain!);
    const placed = trees(m);
    expect(placed.length).toBe(90);
    expect(new Set(placed.map((t) => t.item)).size).toBeGreaterThanOrEqual(3);
    for (const t of placed) {
      expect(m.terrain[m.index(t.x, t.y)]).toBe(Surface.Grass);
      const nearGate =
        t.x >= apron.x0 - 2 && t.x <= apron.x1 + 2 && t.y >= apron.y0 - 2 && t.y <= apron.y1 + 2;
      expect(nearGate).toBe(false);
    }
  });

  it('gives Starter Park its configured groves and shrubs without filling the entrance apron', () => {
    const starter = SCENARIOS.find((scenario) => scenario.id === 'starter');
    if (!starter?.trees) throw new Error('Starter Park tree recipe missing');
    const m = scenarioMap(starter).map;
    const placed = trees(m);
    const treeItems = placed.filter(
      (item) => item.item !== SceneryItem.Shrub && item.item !== SceneryItem.FlowerBed,
    );
    const shrubs = placed.filter((item) => item.item === SceneryItem.Shrub);
    const flowerBeds = placed.filter((item) => item.item === SceneryItem.FlowerBed);

    expect(treeItems).toHaveLength(starter.trees.count);
    expect(shrubs).toHaveLength(starter.trees.shrubs ?? 0);
    expect(flowerBeds).toHaveLength(starter.trees.flowerBeds ?? 0);
    expect(new Set(treeItems.map((tree) => tree.item)).size).toBeGreaterThanOrEqual(3);
    const remainingTrees = new Set(treeItems.map((_, index) => index));
    const groveSizes: number[] = [];
    while (remainingTrees.size > 0) {
      const first = remainingTrees.values().next().value!;
      remainingTrees.delete(first);
      const grove = [first];
      for (let cursor = 0; cursor < grove.length; cursor++) {
        const tree = treeItems[grove[cursor]!]!;
        for (const candidate of [...remainingTrees]) {
          const neighbour = treeItems[candidate]!;
          if (
            tree.item === neighbour.item &&
            Math.abs(tree.x - neighbour.x) <= 4 &&
            Math.abs(tree.y - neighbour.y) <= 4
          ) {
            remainingTrees.delete(candidate);
            grove.push(candidate);
          }
        }
      }
      groveSizes.push(grove.length);
    }
    expect(groveSizes.filter((size) => size >= 5).length).toBeGreaterThanOrEqual(3);
    const apron = buildApron(m.width, m.height, starter.entrance!.side, {
      buildLength: starter.terrain?.buildLength ?? 10,
      buildWidth: starter.terrain?.buildWidth ?? 18,
    });
    const owned = ownedBounds(m.width, m.height, starter.land);
    const spineX = (owned.x0 + owned.x1) >> 1;
    for (const tree of placed) {
      expect(m.terrain[m.index(tree.x, tree.y)]).toBe(Surface.Grass);
      expect(tree.x < apron.x0 || tree.x > apron.x1 || tree.y < apron.y0 || tree.y > apron.y1).toBe(
        true,
      );
      expect(
        Math.abs(tree.x - spineX) <= 14 && owned.y1 - tree.y >= 0 && owned.y1 - tree.y < 30,
      ).toBe(false);
    }
    expect(
      treeItems.some((first) =>
        treeItems.some(
          (second) =>
            first !== second &&
            first.item === second.item &&
            Math.abs(first.x - second.x) <= 2 &&
            Math.abs(first.y - second.y) <= 2,
        ),
      ),
    ).toBe(true);
  });

  it('keeps beach water inside the projected opening viewport of shoreline scenarios', () => {
    for (const scenario of SCENARIOS.filter((entry) =>
      ['lantern-bay', 'seaside-promenade'].includes(entry.id),
    )) {
      const park = world(scenario);
      const { map } = park;
      const entrance = scenario.entrance!;
      const inward = { north: [0, 1], east: [-1, 0], south: [0, -1], west: [1, 0] }[entrance.side];
      const pathCentre = (entrance.length - 1) / 2;
      const camera = new Float64Array(2);
      project(
        (park.park.entranceX + 0.5 + inward[0] * pathCentre) * TILE_UNITS,
        (park.park.entranceY + 0.5 + inward[1] * pathCentre) * TILE_UNITS,
        map.heights[map.index(park.park.entranceX, park.park.entranceY)]! * Z_STEP,
        map.width,
        map.height,
        0,
        camera,
      );
      let visibleWater = 0;
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const index = map.index(x, y);
          if (map.waterLevel[index] <= map.heights[index]) continue;
          const screen = new Float64Array(2);
          project(
            (x + 0.5) * TILE_UNITS,
            (y + 0.5) * TILE_UNITS,
            map.heights[index]! * Z_STEP,
            map.width,
            map.height,
            0,
            screen,
          );
          if (Math.abs(screen[0]! - camera[0]!) <= 640 && Math.abs(screen[1]! - camera[1]!) <= 400)
            visibleWater++;
        }
      }
      expect(visibleWater, scenario.name).toBeGreaterThan(0);
    }
  });
});

describe('prebuilt rides', () => {
  const def = (): ScenarioDef =>
    recipe({
      prebuilt: [
        { type: 'merryGoRound', row: 4, lateral: 6 },
        { type: 'foodStall', row: 8, lateral: -2 },
      ],
    });

  it('opens each ride and leaves cash, loan and the month ledger at the scenario start', () => {
    const w = world(def());
    expect(w.rides.count).toBe(2);
    for (let slot = 0; slot < w.rides.count; slot++) {
      expect(w.rides.cols.state[slot]).toBe(RideState.Open);
    }
    expect(w.economy.cash).toBe(4_000_000);
    expect(w.economy.loan).toBe(1_000_000);
    expect(Array.from(w.economy.monthlyTotals).every((v) => v === 0)).toBe(true);
  });

  it('rejects a ride that hugs the spine', () => {
    expect(() => recipe({ prebuilt: [{ type: 'twist', row: 4, lateral: 1 }] })).toThrow(/lateral/);
  });
});
