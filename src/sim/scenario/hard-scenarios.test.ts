import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { applyMapCommand } from '../map/map-commands';
import { ElementType, OWNED, RIGHTS_OWNED, SALE_LAND, SALE_RIGHTS } from '../map/tile-map';
import type { TileMap } from '../map/tile-map';
import { deserialize, serialize } from '../../save/save';
import { SCENARIOS } from './catalog';
import { prepareScenarioPark } from './scenario-layout';
import type { ScenarioDef } from './scenario';

const HARD = [
  'copper-ridge',
  'tidewater-docks',
  'thunderhead-mesa',
  'glacier-point',
  'mossgrove-isle',
] as const;

const cache = new Map<string, World>();

function def(id: string): ScenarioDef {
  const found = SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`no scenario ${id}`);
  return found;
}

function park(id: string): World {
  let w = cache.get(id);
  if (!w) {
    const d = def(id);
    w = new World({ seed: d.seed, width: d.mapWidth, height: d.mapHeight });
    prepareScenarioPark(w, d);
    cache.set(id, w);
  }
  return w;
}

function ownedTiles(m: TileMap): number[] {
  const out: number[] = [];
  for (let i = 0; i < m.width * m.height; i++) if (m.ownership[i]! & OWNED) out.push(i);
  return out;
}

function bounds(m: TileMap, tiles: readonly number[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (const i of tiles) {
    const x = i % m.width;
    const y = Math.floor(i / m.width);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1, area: (x1 - x0 + 1) * (y1 - y0 + 1) };
}

/** Tiles reachable from `start` through 4-neighbours that satisfy `keep`. */
function region(m: TileMap, start: number, keep: (i: number) => boolean): Set<number> {
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const i = queue.pop()!;
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
      if (!seen.has(n) && keep(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}

const hasScenery = (m: TileMap, i: number): boolean => {
  for (let e = m.firstElement(i); e >= 0; e = m.nextElement(e))
    if (m.elType[e] === ElementType.SmallScenery) return true;
  return false;
};
const dry = (m: TileMap, i: number): boolean => m.waterLevel[i]! <= m.heights[i]!;
const owned = (m: TileMap, i: number): boolean => (m.ownership[i]! & OWNED) !== 0;

/** Flat, dry, empty pockets on owned or purchasable land, of at least `min` tiles, as [size, height] pairs. */
function flatPockets(m: TileMap, min: number): Array<[number, number]> {
  const ownable = (i: number) => (m.ownership[i]! & (OWNED | SALE_LAND)) !== 0;
  const seen = new Set<number>();
  const out: Array<[number, number]> = [];
  const usable = (i: number) =>
    ownable(i) && dry(m, i) && m.slope[i] === 0 && m.firstElement(i) < 0;
  for (let i = 0; i < m.width * m.height; i++) {
    if (seen.has(i) || !usable(i)) continue;
    const h = m.heights[i]!;
    const r = region(m, i, (n) => usable(n) && m.heights[n] === h);
    for (const n of r) seen.add(n);
    if (r.size >= min) out.push([r.size, h]);
  }
  return out;
}

describe.each(HARD)('%s', (id) => {
  it('owns one connected, clearly non-rectangular piece of land', () => {
    const m = park(id).map;
    const tiles = ownedTiles(m);
    const b = bounds(m, tiles);
    expect(tiles.length / b.area).toBeLessThan(0.8);
    expect(region(m, tiles[0]!, (i) => owned(m, i)).size).toBe(tiles.length);
  });

  it('keeps unsellable parcels inside its outline after every sale is bought', () => {
    const w = deserialize(serialize(park(id)));
    const m = w.map;
    w.economy.cash = Number.MAX_SAFE_INTEGER;
    const ownedBefore = ownedTiles(m).length;
    const before = bounds(m, ownedTiles(m));
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
    let locked = 0;
    for (let y = before.y0; y <= before.y1; y++)
      for (let x = before.x0; x <= before.x1; x++)
        if ((m.ownership[m.index(x, y)]! & (OWNED | RIGHTS_OWNED)) === 0) locked++;
    expect(ownedTiles(m).length).toBeGreaterThan(ownedBefore);
    expect(locked).toBeGreaterThan(before.area * 0.1);
  });

  it('starts from a small flat clearing at the gate', () => {
    const w = park(id);
    const m = w.map;
    const gate = m.index(w.park.entranceX, w.park.entranceY);
    const level = m.heights[gate]!;
    const clearing = region(
      m,
      gate,
      (i) =>
        owned(m, i) && dry(m, i) && m.slope[i] === 0 && m.heights[i] === level && !hasScenery(m, i),
    );
    expect(clearing.size).toBeGreaterThanOrEqual(60);
    expect(clearing.size).toBeLessThanOrEqual(420);
  });

  it('varies in height across the land the player owns', () => {
    const m = park(id).map;
    const heights = ownedTiles(m)
      .filter((i) => dry(m, i))
      .map((i) => m.heights[i]!);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThanOrEqual(5);
  });

  it('describes its terrain and challenge for the scenario list', () => {
    const d = def(id);
    expect(d.landscape?.length ?? 0).toBeGreaterThan(10);
    expect(d.challenge?.length ?? 0).toBeGreaterThan(20);
  });
});

describe('hard park identities', () => {
  it('Copper Ridge has several narrow flat benches at different heights', () => {
    const pockets = flatPockets(park('copper-ridge').map, 24);
    expect(pockets.length).toBeGreaterThanOrEqual(4);
    expect(new Set(pockets.map(([, h]) => h)).size).toBeGreaterThanOrEqual(3);
  });

  it('Tidewater Docks wraps water and sells only construction rights over its inlets', () => {
    const m = park('tidewater-docks').map;
    const b = bounds(m, ownedTiles(m));
    let water = 0;
    let rightsOverWater = 0;
    for (let y = b.y0; y <= b.y1; y++)
      for (let x = b.x0; x <= b.x1; x++) {
        const i = m.index(x, y);
        if (dry(m, i)) continue;
        water++;
        if (m.ownership[i]! & SALE_RIGHTS) rightsOverWater++;
        expect(m.ownership[i]! & SALE_LAND).toBe(0);
      }
    expect(water).toBeGreaterThan(b.area * 0.2);
    expect(rightsOverWater).toBeGreaterThan(40);
  });

  it('Thunderhead Mesa splits its land into shelves well apart in height', () => {
    const pockets = flatPockets(park('thunderhead-mesa').map, 30);
    const levels = pockets.map(([, h]) => h);
    expect(pockets.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThanOrEqual(6);
  });

  it('Glacier Point climbs from a lake shore into mountains', () => {
    const m = park('glacier-point').map;
    const tiles = ownedTiles(m);
    const heights = tiles.filter((i) => dry(m, i)).map((i) => m.heights[i]!);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThanOrEqual(9);
    expect(tiles.some((i) => !dry(m, i))).toBe(true);
  });

  it('Mossgrove Isle is a wooded island with open clearings', () => {
    const w = park('mossgrove-isle');
    const m = w.map;
    const tiles = ownedTiles(m).filter((i) => dry(m, i));
    const wooded = tiles.filter((i) => hasScenery(m, i)).length;
    expect(wooded / tiles.length).toBeGreaterThan(0.4);
    const gate = m.index(w.park.entranceX, w.park.entranceY);
    const open = region(m, gate, (i) => owned(m, i) && dry(m, i) && !hasScenery(m, i));
    expect(open.size).toBeGreaterThan(250);
    const b = bounds(m, ownedTiles(m));
    const midX = (b.x0 + b.x1) >> 1;
    const midY = (b.y0 + b.y1) >> 1;
    const ring = [
      [b.x0 - 2, midY],
      [b.x1 + 2, midY],
      [midX, b.y0 - 2],
      [midX, b.y1 + 2],
    ].filter(([x, y]) => m.inBounds(x!, y!));
    expect(ring.length).toBe(4);
    expect(ring.filter(([x, y]) => !dry(m, m.index(x!, y!))).length).toBeGreaterThanOrEqual(3);
  });
});
