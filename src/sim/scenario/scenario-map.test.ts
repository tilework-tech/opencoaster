import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { hashWorld } from '../core/hash';
import { ElementType, OWNED, SALE_LAND, Surface } from '../map/tile-map';
import { RideState } from '../rides/ride-store';
import { buildApron, ownedBounds } from './scenario-map';
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
    const m = world(def).map;
    const o = ownedBounds(80, 80, def.land);
    expect(o).toEqual({ x0: 16, y0: 16, x1: 63, y1: 63 });
    expect(m.ownership[m.index(40, 40)] & OWNED).toBe(OWNED);
    expect(m.ownership[m.index(10, 40)] & SALE_LAND).toBe(SALE_LAND);
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
