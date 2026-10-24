import { describe, expect, it } from 'vitest';
import { TileMap, Surface, ElementType } from './tile-map';
import { TILE_UNITS, Z_STEP } from '../core/constants';

function flatMap(w = 16, h = 16, level = 4): TileMap {
  const m = new TileMap(w, h);
  m.fillFlat(level);
  return m;
}

describe('TileMap terrain', () => {
  it('derives tile base height and corner slope from vertex heights', () => {
    const m = flatMap();
    m.vertexHeights[m.vertexIndex(5, 5)] = 5;
    m.refreshTile(m.index(5, 5));
    expect(m.heights[m.index(5, 5)]).toBe(4);
    expect(m.slope[m.index(5, 5)]).toBe(0b0001);
    expect(m.cornerHeight(5, 5, 0)).toBe(5);
    expect(m.cornerHeight(5, 5, 2)).toBe(4);
  });

  it('interpolates ground height across a sloped tile in fixed point', () => {
    const m = flatMap();
    // corners 1 and 2 (x + 1 side) raised: ramp rising toward +x
    m.vertexHeights[m.vertexIndex(6, 5)] = 5;
    m.vertexHeights[m.vertexIndex(6, 6)] = 5;
    m.refreshTile(m.index(5, 5));
    const base = 4 * Z_STEP;
    expect(m.terrainHeightAt(5 * TILE_UNITS, 5 * TILE_UNITS + 100)).toBe(base);
    expect(m.terrainHeightAt(5 * TILE_UNITS + 128, 5 * TILE_UNITS + 40)).toBe(base + Z_STEP / 2);
    expect(m.terrainHeightAt(5 * TILE_UNITS + 255, 5 * TILE_UNITS)).toBe(base + 63);
  });

  it('clamps height queries to the map', () => {
    const m = flatMap();
    expect(m.terrainHeightAt(-500, 99999)).toBe(4 * Z_STEP);
  });
});

describe('TileMap element stacks', () => {
  it('keeps each tile stack sorted by base height and reuses freed slots', () => {
    const m = flatMap();
    const i = m.index(3, 3);
    const hi = m.addElement(i, ElementType.Path, 8, 10, 0, 0);
    const lo = m.addElement(i, ElementType.Track, 4, 6, 0, 0);
    expect(m.firstElement(i)).toBe(lo);
    expect(m.nextElement(lo)).toBe(hi);
    expect(m.nextElement(hi)).toBe(-1);
    m.removeElement(i, lo);
    expect(m.firstElement(i)).toBe(hi);
    expect(m.addElement(i, ElementType.Wall, 1, 2, 0, 0)).toBe(lo);
    expect(m.elementCount).toBe(2);
  });

  it('returns -1 when the element pool is full', () => {
    const m = new TileMap(2, 2, 3);
    for (let k = 0; k < 3; k++) expect(m.addElement(0, ElementType.Wall, k, k + 1, 0, 0)).toBe(k);
    expect(m.addElement(1, ElementType.Wall, 0, 1, 0, 0)).toBe(-1);
  });
});

describe('TileMap surface class', () => {
  it('reports water when the water level exceeds the tile base', () => {
    const m = flatMap(8, 8, 2);
    m.waterLevel[m.index(1, 1)] = 3;
    m.refreshTile(m.index(1, 1));
    expect(m.surface[m.index(1, 1)]).toBe(Surface.Water);
    expect(m.surface[m.index(2, 2)]).toBe(Surface.Grass);
  });
});
