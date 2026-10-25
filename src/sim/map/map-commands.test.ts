import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { hashWorld } from '../core/hash';
import {
  OWNED,
  SALE_LAND,
  SALE_RIGHTS,
  RIGHTS_OWNED,
  LAND_PRICE_CENTS,
  MAX_HEIGHT,
} from './tile-map';
import { serialize, deserialize } from '../../save/save';
import { dropLitter, LitterKind } from '../guests/litter-store';
import { landEditCostCents } from './land';
import { placePath, removePath } from './paths';

function sim(): Simulation {
  const s = new Simulation({ seed: 9, width: 32, height: 32, maxGuests: 100 });
  s.world.map.ownership.fill(OWNED);
  s.world.map.waterLevel.fill(0);
  s.world.map.fillFlat(4);
  return s;
}

describe('map commands', () => {
  it('place and remove paths through the command queue, charging construction', () => {
    const s = sim();
    const cash = s.world.economy.cash;
    s.enqueue({ type: 'placePath', x: 4, y: 4 });
    s.enqueue({ type: 'placePath', x: 5, y: 4 });
    s.step();
    expect(s.world.map.pathEdges(s.world.map.index(4, 4))).toBe(0b0001);
    expect(s.world.economy.cash).toBeLessThan(cash);
    s.enqueue({ type: 'removePath', x: 5, y: 4 });
    s.step();
    expect(s.world.map.pathEdges(s.world.map.index(4, 4))).toBe(0);
  });

  it('raises and lowers land and changes the map revision', () => {
    const s = sim();
    const rev = s.world.map.revision;
    const i = s.world.map.index(10, 10);
    const h = s.world.map.heights[i];
    s.enqueue({ type: 'raiseLand', x: 10, y: 10, width: 1, height: 1 });
    s.step();
    expect(s.world.map.heights[i]).toBe(h + 1);
    expect(s.world.map.revision).toBeGreaterThan(rev);
    s.enqueue({ type: 'lowerLand', x: 10, y: 10, width: 1, height: 1 });
    s.step();
    expect(s.world.map.heights[i]).toBe(h);
  });

  it('charges shared terrain corners once and water changes per tile', () => {
    const s = sim();
    const cash = s.world.economy.cash;
    s.enqueue({ type: 'raiseLand', x: 10, y: 10, width: 2, height: 1 });
    s.step();
    expect(cash - s.world.economy.cash).toBe(3_000);

    const afterRaise = s.world.economy.cash;
    s.enqueue({ type: 'setWater', x: 12, y: 12, width: 2, height: 2, level: 31 });
    s.step();
    expect(afterRaise - s.world.economy.cash).toBe(1_000);
  });

  it('prices every height unit changed by propagated lowering', () => {
    const s = sim();
    const m = s.world.map;
    const x = 10;
    const y = 10;
    m.vertexHeights[m.vertexIndex(x, y)] = 4;
    m.vertexHeights[m.vertexIndex(x + 1, y)] = 4;
    m.vertexHeights[m.vertexIndex(x, y + 1)] = 4;
    m.vertexHeights[m.vertexIndex(x + 1, y + 1)] = 4;
    m.vertexHeights[m.vertexIndex(x + 2, y)] = 5;
    m.vertexHeights[m.vertexIndex(x + 2, y + 1)] = 5;
    m.refreshTile(m.index(x, y));
    m.refreshTile(m.index(x + 1, y));

    expect(landEditCostCents(m, x, y, 2, 1, false)).toBe(3_000);
  });

  it('charges only selected vertices that can move in the requested direction', () => {
    const s = sim();
    const m = s.world.map;
    const x = 10;
    const y = 10;
    const northWest = m.vertexIndex(x, y);
    m.vertexHeights[northWest] = MAX_HEIGHT;
    m.refreshTile(m.index(x, y));

    expect(landEditCostCents(m, x, y, 1, 1, true)).toBe(1_500);

    m.vertexHeights[northWest] = 0;
    m.refreshTile(m.index(x, y));
    expect(landEditCostCents(m, x, y, 1, 1, false)).toBe(1_500);
  });

  it('does not charge a saturated corner raise or lower', () => {
    const s = sim();
    const m = s.world.map;
    const x = 10;
    const y = 10;
    m.vertexHeights[m.vertexIndex(x, y)] = MAX_HEIGHT;
    m.refreshTile(m.index(x, y));
    expect(landEditCostCents(m, x, y, 1, 1, true, 0)).toBe(0);

    m.vertexHeights[m.vertexIndex(x, y)] = 0;
    m.refreshTile(m.index(x, y));
    expect(landEditCostCents(m, x, y, 1, 1, false, 0)).toBe(0);
  });

  it('removes litter from tiles whose terrain is changed', () => {
    const s = sim();
    expect(s.world.map.pathElement(s.world.map.index(10, 10), -1)).toBe(-1);
    expect(s.world.map.addElement(s.world.map.index(10, 10), 1, 6, 8, 0, 0)).toBeGreaterThanOrEqual(
      0,
    );
    expect(dropLitter(s.world, 10, 10, LitterKind.Trash)).toBe(true);
    expect(s.world.litter.count).toBe(1);

    s.enqueue({ type: 'raiseLand', x: 10, y: 10, width: 1, height: 1 });
    s.step();

    expect(s.world.litter.count).toBe(0);
  });

  it('charges and clears every tile affected by propagated corner changes', () => {
    const s = sim();
    const m = s.world.map;
    expect(placePath(m, { x: 10, y: 9, z: 4 })).toBe(true);
    expect(dropLitter(s.world, 10, 9, LitterKind.Trash)).toBe(true);
    expect(removePath(m, { x: 10, y: 9, z: 4 })).toBe(true);
    expect(placePath(m, { x: 9, y: 9, z: 4 })).toBe(true);
    expect(dropLitter(s.world, 9, 9, LitterKind.Trash)).toBe(true);
    expect(removePath(m, { x: 9, y: 9, z: 4 })).toBe(true);
    m.vertexHeights[m.vertexIndex(11, 10)] = 3;
    for (let y = 9; y <= 10; y++) for (let x = 9; x <= 11; x++) m.refreshTile(m.index(x, y));
    const cash = s.world.economy.cash;

    s.enqueue({ type: 'raiseLand', x: 10, y: 10, width: 1, height: 1, corner: 0 });
    s.step();

    expect(m.vertexHeights[m.vertexIndex(11, 10)]).toBe(4);
    expect(cash - s.world.economy.cash).toBe(1_000);
    expect(s.world.litter.count).toBe(0);
  });

  it('rejects absolute terrain edits outside owned land and beyond available cash', () => {
    const unowned = sim();
    unowned.world.map.ownership[unowned.world.map.index(10, 10)] = 0;
    const unownedCash = unowned.world.economy.cash;
    unowned.enqueue({ type: 'setTileHeight', x: 10, y: 10, height: 5 });
    unowned.step();
    expect(unowned.world.map.heights[unowned.world.map.index(10, 10)]).toBe(4);
    expect(unowned.world.economy.cash).toBe(unownedCash);

    const unaffordable = sim();
    unaffordable.world.economy.cash = 0;
    unaffordable.enqueue({ type: 'setTileHeight', x: 10, y: 10, height: 5 });
    unaffordable.step();
    expect(unaffordable.world.map.heights[unaffordable.world.map.index(10, 10)]).toBe(4);
    expect(unaffordable.world.economy.cash).toBe(0);

    const affordable = sim();
    const affordableCash = affordable.world.economy.cash;
    affordable.enqueue({ type: 'setTileHeight', x: 10, y: 10, height: 5 });
    affordable.step();
    expect(affordable.world.map.heights[affordable.world.map.index(10, 10)]).toBe(5);
    expect(affordableCash - affordable.world.economy.cash).toBe(2_000);
  });

  it('buys land and construction rights atomically against available cash', () => {
    const s = sim();
    const m = s.world.map;
    m.ownership.fill(0);
    m.ownership[m.index(3, 3)] = SALE_LAND;
    m.ownership[m.index(4, 3)] = SALE_RIGHTS;
    m.ownership[m.index(5, 3)] = 0;
    const cash = s.world.economy.cash;
    s.enqueue({ type: 'buyLand', x: 3, y: 3, width: 1, height: 1, rights: false });
    s.enqueue({ type: 'buyLand', x: 4, y: 3, width: 1, height: 1, rights: true });
    s.enqueue({ type: 'buyLand', x: 5, y: 3, width: 1, height: 1, rights: false });
    s.step();
    expect(m.ownership[m.index(3, 3)] & OWNED).toBeTruthy();
    expect(m.ownership[m.index(3, 3)] & SALE_LAND).toBe(0);
    expect(m.ownership[m.index(4, 3)] & RIGHTS_OWNED).toBeTruthy();
    expect(m.ownership[m.index(5, 3)]).toBe(0);
    expect(s.world.economy.cash).toBeLessThan(cash);
    expect(cash - s.world.economy.cash).toBeGreaterThanOrEqual(LAND_PRICE_CENTS);

    s.world.economy.cash = 0;
    m.ownership[m.index(6, 3)] = SALE_LAND;
    s.enqueue({ type: 'buyLand', x: 6, y: 3, width: 1, height: 1, rights: false });
    s.step();
    expect(m.ownership[m.index(6, 3)]).toBe(SALE_LAND);
  });

  it('sets water level and terrain type', () => {
    const s = sim();
    const m = s.world.map;
    s.enqueue({ type: 'setWater', x: 12, y: 12, width: 2, height: 2, level: 31 });
    s.enqueue({ type: 'paintLand', x: 20, y: 20, width: 1, height: 1, surface: 1 });
    s.step();
    expect(m.waterLevel[m.index(12, 12)]).toBe(31);
    expect(m.terrain[m.index(20, 20)]).toBe(1);
  });

  it('replays identically and survives save/load', () => {
    const script = (s: Simulation): void => {
      s.enqueue({ type: 'raiseLand', x: 9, y: 9, width: 2, height: 2 });
      for (let x = 4; x < 12; x++) s.enqueue({ type: 'placePath', x, y: 4 });
      s.enqueue({ type: 'removePath', x: 7, y: 4 });
      s.enqueue({ type: 'placePath', x: 7, y: 4, queue: true });
    };
    const a = sim();
    const b = sim();
    script(a);
    script(b);
    for (let i = 0; i < 5; i++) {
      a.step();
      b.step();
    }
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));

    const loaded = deserialize(serialize(a.world));
    expect(hashWorld(loaded)).toBe(hashWorld(a.world));
    expect(loaded.map.pathEdges(loaded.map.index(5, 4))).toBe(
      a.world.map.pathEdges(a.world.map.index(5, 4)),
    );
    expect(loaded.map.elementCount).toBe(a.world.map.elementCount);
  });
});
