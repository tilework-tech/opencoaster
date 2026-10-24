import { describe, expect, it } from 'vitest';
import { TileMap, ElementType, OWNED } from './tile-map';
import { lowerLand, raiseLand, generateTerrain } from './index';
import { Prng } from '../core/prng';

function ownedMap(w = 16, h = 16, level = 4): TileMap {
  const m = new TileMap(w, h);
  m.fillFlat(level);
  m.ownership.fill(OWNED);
  return m;
}

function assertSmooth(m: TileMap): void {
  for (let y = 0; y <= m.height; y++) {
    for (let x = 0; x <= m.width; x++) {
      const v = m.vertexHeights[m.vertexIndex(x, y)];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx > m.width || ny > m.height) continue;
          expect(Math.abs(v - m.vertexHeights[m.vertexIndex(nx, ny)])).toBeLessThanOrEqual(1);
        }
      }
    }
  }
}

describe('raiseLand / lowerLand', () => {
  it('raises a whole tile by one level and keeps neighbours within one step', () => {
    const m = ownedMap();
    expect(raiseLand(m, 5, 5, 1, 1)).toBe(true);
    expect(m.heights[m.index(5, 5)]).toBe(5);
    expect(m.slope[m.index(5, 5)]).toBe(0);
    expect(m.slope[m.index(4, 5)]).toBe(0b0110);
    assertSmooth(m);
  });

  it('cascades repeated raises into a smooth hill', () => {
    const m = ownedMap();
    for (let k = 0; k < 4; k++) raiseLand(m, 8, 8, 1, 1);
    expect(m.heights[m.index(8, 8)]).toBe(8);
    assertSmooth(m);
  });

  it('raises a single corner of a tile into a slope', () => {
    const m = ownedMap();
    expect(raiseLand(m, 5, 5, 1, 1, 2)).toBe(true);
    expect(m.slope[m.index(5, 5)]).toBe(0b0100);
    expect(m.heights[m.index(5, 5)]).toBe(4);
  });

  it('lowers land and clamps at zero and the max height', () => {
    const m = ownedMap(8, 8, 0);
    expect(lowerLand(m, 2, 2, 1, 1)).toBe(false);
    expect(m.heights[m.index(2, 2)]).toBe(0);
    const t = ownedMap(8, 8, 31);
    expect(raiseLand(t, 2, 2, 1, 1)).toBe(false);
    expect(t.heights[t.index(2, 2)]).toBe(31);
  });

  it('refuses unowned land', () => {
    const m = ownedMap();
    m.ownership[m.index(5, 5)] = 0;
    expect(raiseLand(m, 5, 5, 1, 1)).toBe(false);
    expect(m.heights[m.index(5, 5)]).toBe(4);
  });

  it('rolls back when the edit would bury a ground path piece', () => {
    const m = ownedMap();
    m.addElement(m.index(5, 5), ElementType.Path, 4, 6, 0, 0);
    // raising the neighbour would slope the tile under the path
    expect(raiseLand(m, 6, 5, 1, 1, 0)).toBe(false);
    expect(m.vertexHeights[m.vertexIndex(6, 5)]).toBe(4);
    expect(m.slope[m.index(5, 5)]).toBe(0);
  });
});

describe('generateTerrain', () => {
  it('produces smooth terrain deterministically', () => {
    const a = new TileMap(64, 64);
    const b = new TileMap(64, 64);
    generateTerrain(a, new Prng(5));
    generateTerrain(b, new Prng(5));
    assertSmooth(a);
    expect(Array.from(a.vertexHeights)).toEqual(Array.from(b.vertexHeights));
    expect(Array.from(a.slope)).toEqual(Array.from(b.slope));
  });
});
