import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { hashWorld } from '../core/hash';
import { applyMapCommand } from '../map/map-commands';
import { ElementType, OWNED, RIGHTS_OWNED, SALE_LAND, SALE_RIGHTS } from '../map/tile-map';
import { SceneryItem } from '../map/scenery';
import { parseScenarioFile } from './scenario-file';
import { prepareScenario, prepareScenarioPark } from './scenario-layout';
import type { ScenarioDef } from './scenario';

const BASE = {
  id: 'shape-test',
  name: 'Shape Test',
  seed: 5,
  map: { width: 64, height: 64 },
  finance: {
    startingCash: 4_000_000,
    startingLoan: 0,
    maxLoan: 5_000_000,
    annualInterestBps: 800,
  },
  pricing: { mode: 'admission', admissionPrice: 300 },
  entrance: { side: 'south', length: 4 },
  objective: { kind: 'guests', target: 50, byYear: 1 },
};

const TERRAIN = {
  seaLevel: 3,
  baseLevel: 6,
  relief: 0,
  cell: 8,
  buildLevel: 6,
  buildLength: 10,
  buildWidth: 9,
};

/** An L of owned land: a southern strip across the map plus a western arm running north. */
const L_PARCELS = [
  { kind: 'rights', rect: [4, 4, 59, 59] },
  { kind: 'land', rect: [8, 8, 55, 55] },
  { kind: 'owned', rect: [10, 44, 53, 53] },
  { kind: 'owned', rect: [10, 10, 21, 43] },
  { kind: 'none', rect: [30, 14, 50, 36] },
];

function recipe(overrides: Record<string, unknown> = {}): ScenarioDef {
  return parseScenarioFile({
    ...BASE,
    land: { parcels: L_PARCELS },
    terrain: TERRAIN,
    ...overrides,
  });
}

function parkWorld(def: ScenarioDef): World {
  const w = new World({ seed: def.seed, width: def.mapWidth, height: def.mapHeight });
  prepareScenarioPark(w, def);
  return w;
}

function own(w: World, x: number, y: number): number {
  return w.map.ownership[w.map.index(x, y)]!;
}

function scenery(w: World, x: number, y: number): SceneryItem | null {
  const m = w.map;
  const i = m.index(x, y);
  for (let e = m.firstElement(i); e >= 0; e = m.nextElement(e))
    if (m.elType[e] === ElementType.SmallScenery) return m.elData[e] as SceneryItem;
  return null;
}

describe('land parcels', () => {
  it('owns exactly the painted owned shapes, and sells land and rights where painted', () => {
    const w = parkWorld(recipe());
    expect(own(w, 15, 20) & OWNED).toBe(OWNED);
    expect(own(w, 40, 50) & OWNED).toBe(OWNED);
    expect(own(w, 40, 30) & OWNED).toBe(0);
    expect(own(w, 26, 30) & SALE_LAND).toBe(SALE_LAND);
    expect(own(w, 6, 30) & SALE_RIGHTS).toBe(SALE_RIGHTS);
    expect(own(w, 2, 30)).toBe(0);
  });

  it('keeps no-sale parcels unowned after buying every tile and right on the map', () => {
    const w = parkWorld(recipe());
    w.economy.cash = Number.MAX_SAFE_INTEGER;
    const m = w.map;
    applyMapCommand(w, {
      type: 'buyLand',
      x: 0,
      y: 0,
      width: m.width,
      height: m.height,
      rights: false,
    });
    applyMapCommand(w, {
      type: 'buyLand',
      x: 0,
      y: 0,
      width: m.width,
      height: m.height,
      rights: true,
    });
    expect(own(w, 26, 30) & OWNED).toBe(OWNED);
    expect(own(w, 6, 30) & RIGHTS_OWNED).toBe(RIGHTS_OWNED);
    for (const [x, y] of [
      [30, 14],
      [40, 25],
      [50, 36],
    ] as const)
      expect(own(w, x, y)).toBe(0);
  });

  it('puts the gate and a flat owned apron at the offset along the owned edge', () => {
    const w = parkWorld(recipe({ terrain: { ...TERRAIN, apronOffset: -12 } }));
    const m = w.map;
    expect(own(w, w.park.entranceX, w.park.entranceY) & OWNED).toBe(OWNED);
    expect(w.park.entranceY).toBe(53);
    expect(w.park.entranceX).toBeGreaterThanOrEqual(15);
    expect(w.park.entranceX).toBeLessThanOrEqual(23);
    for (let y = 44; y <= 53; y++)
      for (let x = 15; x <= 23; x++) {
        const i = m.index(x, y);
        expect(own(w, x, y) & OWNED).toBe(OWNED);
        expect(m.heights[i]).toBe(TERRAIN.buildLevel);
        expect(m.slope[i]).toBe(0);
      }
  });

  it('rejects owned land in more than one piece', () => {
    expect(() =>
      recipe({
        land: {
          parcels: [
            { kind: 'owned', rect: [10, 44, 53, 53] },
            { kind: 'owned', rect: [10, 10, 20, 30] },
          ],
        },
      }),
    ).toThrow(/owned land must be one connected piece/);
  });

  it('rejects an apron that leaves the owned shape', () => {
    expect(() => recipe({ terrain: { ...TERRAIN, apronOffset: 20 } })).toThrow(
      /apron .* must fit inside the owned land/,
    );
    expect(() => recipe({ terrain: { ...TERRAIN, apronOffset: 15 } })).not.toThrow();
  });

  it('rejects shapes outside the map and unknown parcel kinds', () => {
    expect(() =>
      recipe({ land: { parcels: [{ kind: 'owned', rect: [10, 44, 70, 53] }] } }),
    ).toThrow(/land.parcels\[0\]/);
    expect(() =>
      recipe({ land: { parcels: [{ kind: 'castle', rect: [10, 44, 53, 53] }] } }),
    ).toThrow(/land.parcels\[0\].kind/);
  });

  it('accepts ellipses and bands as parcel shapes', () => {
    const w = parkWorld(
      recipe({
        land: {
          parcels: [
            { kind: 'owned', rect: [16, 44, 48, 53] },
            { kind: 'owned', ellipse: [32, 30, 12, 8] },
            { kind: 'owned', band: [32, 44, 32, 8, 1] },
          ],
        },
      }),
    );
    expect(own(w, 32, 10) & OWNED).toBe(OWNED);
    expect(own(w, 36, 10) & OWNED).toBe(0);
    expect(own(w, 22, 30) & OWNED).toBe(OWNED);
    expect(own(w, 22, 22) & OWNED).toBe(0);
  });
});

describe('terrain shapes', () => {
  it('raises a ridge along a band and keeps every tile within one level of slope', () => {
    const w = parkWorld(
      recipe({
        terrain: { ...TERRAIN, shapes: [{ mode: 'raise', level: 15, band: [12, 12, 52, 12, 1] }] },
      }),
    );
    const m = w.map;
    expect(m.heights[m.index(32, 12)]).toBeGreaterThanOrEqual(14);
    expect(m.heights[m.index(32, 30)]).toBeLessThanOrEqual(8);
    for (let vy = 0; vy < m.height; vy++)
      for (let vx = 0; vx < m.width; vx++) {
        const v = m.vertexHeights[m.vertexIndex(vx, vy)]!;
        expect(Math.abs(v - m.vertexHeights[m.vertexIndex(vx + 1, vy)]!)).toBeLessThanOrEqual(1);
        expect(Math.abs(v - m.vertexHeights[m.vertexIndex(vx, vy + 1)]!)).toBeLessThanOrEqual(1);
      }
  });

  it('fills ground cut below sea level with water, even inland, and leaves the banks dry', () => {
    const w = parkWorld(
      recipe({
        terrain: { ...TERRAIN, shapes: [{ mode: 'lower', level: 1, band: [12, 20, 52, 20, 2] }] },
      }),
    );
    const m = w.map;
    const inChannel = m.index(40, 20);
    const beside = m.index(40, 30);
    expect(m.waterLevel[inChannel]).toBeGreaterThan(m.heights[inChannel]!);
    expect(m.waterLevel[beside]).toBeLessThanOrEqual(m.heights[beside]!);
  });
});

describe('tree stands and clearings', () => {
  const forest = {
    count: 400,
    groves: 6,
    stands: [{ density: 70, rect: [10, 10, 21, 43] }],
    clearings: [{ rect: [12, 20, 19, 27] }],
  };

  it('fills a stand densely, at random rather than on a grid', () => {
    const w = parkWorld(recipe({ trees: forest }));
    let trees = 0;
    let free = 0;
    const rows = new Set<string>();
    for (let y = 30; y <= 43; y++) {
      let row = '';
      for (let x = 10; x <= 21; x++) {
        const s = scenery(w, x, y);
        row += s === null ? '.' : 'T';
        if (s === null) free++;
        else trees++;
      }
      rows.add(row);
    }
    expect(trees / (trees + free)).toBeGreaterThan(0.45);
    expect(rows.size).toBeGreaterThan(8);
  });

  it('keeps clearings and the gate area free of trees, including ambient trees', () => {
    const w = parkWorld(recipe({ trees: forest }));
    for (let y = 20; y <= 27; y++)
      for (let x = 12; x <= 19; x++) expect(scenery(w, x, y)).toBeNull();
    for (let y = 44; y <= 53; y++)
      for (let x = 27; x <= 35; x++) expect(scenery(w, x, y)).toBeNull();
    let beside = 0;
    for (let y = 30; y <= 43; y++) for (let x = 10; x <= 21; x++) if (scenery(w, x, y)) beside++;
    expect(beside).toBeGreaterThan(30);
  });

  it('mixes boulders into a stand when asked', () => {
    const w = parkWorld(
      recipe({
        trees: { ...forest, stands: [{ density: 60, rocks: 50, rect: [10, 10, 21, 43] }] },
      }),
    );
    let rocks = 0;
    for (let y = 10; y <= 43; y++)
      for (let x = 10; x <= 21; x++) {
        const s = scenery(w, x, y);
        if (s === SceneryItem.Boulder || s === SceneryItem.RockCluster) rocks++;
      }
    expect(rocks).toBeGreaterThan(20);
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const def = recipe({ trees: forest });
    const a = new World({ seed: 3, width: 64, height: 64 });
    const b = new World({ seed: 3, width: 64, height: 64 });
    prepareScenario(a, def);
    prepareScenario(b, def);
    expect(hashWorld(a)).toBe(hashWorld(b));
    const c = new World({ seed: 4, width: 64, height: 64 });
    prepareScenario(c, def);
    expect(hashWorld(c)).not.toBe(hashWorld(a));
  });
});
