import { describe, expect, it } from 'vitest';
import {
  terrainEdgeFace,
  terrainLightFactor,
  terrainTileCorners,
  viewTerrainCornerHeights,
  waterCoversTerrainTile,
} from './terrain-geometry';

describe('terrain tile geometry', () => {
  it('joins shared raised corners between adjacent tiles', () => {
    const west = terrainTileCorners(8, 12, 2, 0b0110);
    const east = terrainTileCorners(9, 12, 2, 0b1001);

    expect(west[1]).toEqual(east[0]);
    expect(west[2]).toEqual(east[3]);
  });

  it('keeps the projected hill corners aligned after every quarter turn', () => {
    const corners = [10, 20, 30, 40] as const;
    expect([0, 1, 2, 3].map((rotation) => viewTerrainCornerHeights(corners, rotation))).toEqual([
      [10, 20, 30, 40],
      [40, 10, 20, 30],
      [30, 40, 10, 20],
      [20, 30, 40, 10],
    ]);
  });

  it('keeps flat terrain neutral and distinguishes faces with opposite slope directions', () => {
    expect(terrainLightFactor([64, 64, 64, 64])).toBe(1);
    expect(terrainLightFactor([0, 64, 64, 0])).toBeGreaterThan(1);
    expect(terrainLightFactor([64, 0, 0, 64])).toBeLessThan(1);
  });

  it('creates a cliff face only below an exposed raised edge', () => {
    const corners = terrainTileCorners(8, 12, 3, 0b0011);

    expect(terrainEdgeFace(corners, 0, 2)).toEqual({
      start: { x: 9, y: 12, height: 4 },
      end: { x: 9, y: 13, height: 3 },
      bottomHeight: 2,
    });
    expect(terrainEdgeFace(corners, 0, 4)).toBeNull();
    expect(terrainEdgeFace(corners, 1, 4)).toBeNull();
    expect(terrainEdgeFace(corners, 9, 2)).toBeNull();
    expect(terrainEdgeFace(terrainTileCorners(0, 0, 2, 0), 0, 2)).toBeNull();
  });

  it('covers a tile with water only when its entire surface is below water level', () => {
    expect(waterCoversTerrainTile(4, 0, 2)).toBe(true);
    expect(waterCoversTerrainTile(2, 0b0100, 2)).toBe(false);
    expect(waterCoversTerrainTile(0, 0, 4)).toBe(false);
  });
});
