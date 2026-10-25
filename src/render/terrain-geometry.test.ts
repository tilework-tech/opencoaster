import { describe, expect, it } from 'vitest';
import {
  clipTerrainTileBelowHeight,
  terrainEdgeFace,
  terrainLightFactor,
  terrainShorelineSegments,
  terrainTileCorners,
  viewTerrainCornerHeights,
  waterCoversTerrainTile,
  waterIntersectsTerrainTile,
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

  it('keeps a partially submerged slope in the water render pass for shoreline clipping', () => {
    expect(waterIntersectsTerrainTile(3, 0b0100, 2)).toBe(true);
    expect(waterIntersectsTerrainTile(2, 0b0100, 2)).toBe(false);
    expect(waterIntersectsTerrainTile(0, 0, 0)).toBe(false);
  });

  it('clips the water footprint to submerged terrain corners and interpolates the shoreline', () => {
    const corners = terrainTileCorners(8, 12, 2, 0b0100);
    const wet = clipTerrainTileBelowHeight(corners, 2.5);

    expect(wet).toEqual([
      { x: 8, y: 12, height: 2 },
      { x: 9, y: 12, height: 2 },
      { x: 9, y: 12.5, height: 2.5 },
      { x: 8.5, y: 13, height: 2.5 },
      { x: 8, y: 13, height: 2 },
    ]);
    expect(clipTerrainTileBelowHeight(corners, 1.5)).toEqual([]);
    expect(clipTerrainTileBelowHeight(corners, 4)).toEqual(corners);
  });

  it('gives adjacent shoreline tiles identical intersections on their shared edge', () => {
    const west = terrainTileCorners(8, 12, 2, 0b0010);
    const east = terrainTileCorners(9, 12, 2, 0b0001);
    const westWet = clipTerrainTileBelowHeight(west, 2.5);
    const eastWet = clipTerrainTileBelowHeight(east, 2.5);

    expect(westWet.filter((corner) => corner.x === 9)).toEqual(
      eastWet.filter((corner) => corner.x === 9),
    );
  });

  it('keeps every shoreline polygon finite and inside its terrain tile for all corner masks', () => {
    for (let mask = 0; mask < 16; mask++) {
      const clipped = clipTerrainTileBelowHeight(terrainTileCorners(8, 12, 2, mask), 2.5);
      expect(clipped.every((corner) => corner.x >= 8 && corner.x <= 9)).toBe(true);
      expect(clipped.every((corner) => corner.y >= 12 && corner.y <= 13)).toBe(true);
      expect(
        clipped.every((corner) => Number.isFinite(corner.height) && corner.height <= 2.5),
      ).toBe(true);
      expect(new Set(clipped.map(({ x, y }) => `${x},${y}`)).size).toBe(clipped.length);
    }
  });

  it('forms one or two complete waterline segments at convex and concave corners', () => {
    const corners = (mask: number) => terrainTileCorners(8, 12, 2, mask);
    expect(terrainShorelineSegments(corners(0b0100), 2.5)).toHaveLength(1);
    expect(terrainShorelineSegments(corners(0b0101), 2.5)).toHaveLength(2);
    const atCorner = clipTerrainTileBelowHeight(corners(0b0100), 3);
    expect(new Set(atCorner.map(({ x, y }) => `${x},${y}`)).size).toBe(atCorner.length);
  });
});
