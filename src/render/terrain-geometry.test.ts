import { describe, expect, it } from 'vitest';
import {
  terrainEdgeFacesViewer,
  terrainNeighborEdgeBase,
  clipTerrainTileBelowHeight,
  clipTerrainTileTrianglesBelowHeight,
  tileBankDepth,
  tileWaterDepth,
  terrainEdgeFace,
  terrainContourEdges,
  terrainContourViewEdges,
  terrainLightFactor,
  terrainShorelineSegments,
  terrainTileCorners,
  viewTerrainCornerHeights,
  waterCoversTerrainTile,
  waterIntersectsTerrainTile,
} from './terrain-geometry';

function polygonArea(polygon: readonly { x: number; y: number }[]): number {
  let doubledArea = 0;
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    doubledArea += start.x * end.y - end.x * start.y;
  }
  return Math.abs(doubledArea) / 2;
}

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

  it('keeps water split across the raised diagonal on alternating corner heights', () => {
    const corners = terrainTileCorners(8, 12, 2, 0b1010);
    const submerged = clipTerrainTileTrianglesBelowHeight(corners, 2.5, 0);

    expect(submerged).toHaveLength(2);
    expect(submerged[0]).toContainEqual({ x: 8, y: 12, height: 2 });
    expect(submerged[1]).toContainEqual({ x: 9, y: 13, height: 2 });
    expect(terrainShorelineSegments(corners, 2.5, 0)).toHaveLength(2);
  });

  it('clips alternating corners along the diagonal each view rotation draws', () => {
    const corners = terrainTileCorners(8, 12, 2, 0b0101);
    const wetArea = (rotation: number) =>
      clipTerrainTileTrianglesBelowHeight(corners, 2.5, rotation).reduce(
        (sum, polygon) => sum + polygonArea(polygon),
        0,
      );

    expect(wetArea(0)).toBeCloseTo(0.75);
    expect(wetArea(1)).toBeCloseTo(0.25);
    expect(wetArea(2)).toBeCloseTo(0.75);
    expect(wetArea(3)).toBeCloseTo(0.25);
  });

  it("draws a tile's bank faces after that tile's water surface", () => {
    for (let waterLevel = 1; waterLevel <= 4; waterLevel++) {
      expect(tileBankDepth(5, 7, waterLevel)).toBeGreaterThan(tileWaterDepth(5, 7, waterLevel));
    }
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
    expect(terrainShorelineSegments(corners(0b0100), 2.5, 0)).toHaveLength(1);
    expect(terrainShorelineSegments(corners(0b0101), 2.5, 0)).toHaveLength(2);
    const atCorner = clipTerrainTileBelowHeight(corners(0b0100), 3);
    expect(new Set(atCorner.map(({ x, y }) => `${x},${y}`)).size).toBe(atCorner.length);
  });
});

describe('terrain lighting', () => {
  it('lights slopes from one side so facing slopes differ clearly', () => {
    const rightUp = terrainLightFactor([0, 64, 64, 0]);
    const leftUp = terrainLightFactor([64, 0, 0, 64]);
    expect(rightUp).toBeGreaterThan(1.15);
    expect(leftUp).toBeLessThan(0.85);
  });

  it('darkens a slope that climbs away from the light and lightens one toward it', () => {
    expect(terrainLightFactor([64, 0, 0, 0])).toBeLessThan(1);
    expect(terrainLightFactor([0, 0, 64, 0])).toBeGreaterThan(1);
  });
});

describe('terrain contour edges', () => {
  function grid(width: number, height: number, level: number) {
    return {
      width,
      height,
      heights: new Uint8Array(width * height).fill(level),
      slope: new Uint8Array(width * height),
    };
  }

  it('has no contours on flat ground', () => {
    const map = grid(3, 3, 2);
    expect(terrainContourEdges(map, 1, 1)).toBe(0);
  });

  it('marks the edge where flat ground meets the foot of a slope', () => {
    const map = grid(3, 3, 2);
    // tile (1,1) rises along its far x edge: corners 1 and 2 raised
    map.slope[1 * 3 + 1] = 0b0110;
    // its foot (edge 3, corners 3 and 0) is level at 2 and the neighbour at x-1 is flat
    expect(terrainContourEdges(map, 1, 1) & 0b1000).toBe(0b1000);
    // the flat neighbour sees the same crease on its edge 1
    expect(terrainContourEdges(map, 0, 1) & 0b0010).toBe(0b0010);
  });

  it('does not mark an edge where a slope continues across the tile boundary', () => {
    const map = grid(3, 1, 2);
    map.slope[0] = 0b0110;
    map.heights[1] = 3;
    map.slope[1] = 0b0110;
    expect(terrainContourEdges(map, 0, 0) & 0b0010).toBe(0);
  });

  it('marks a step between tiles of different heights', () => {
    const map = grid(2, 1, 2);
    map.heights[1] = 4;
    expect(terrainContourEdges(map, 0, 0) & 0b0010).toBe(0b0010);
    expect(terrainContourEdges(map, 1, 0) & 0b1000).toBe(0b1000);
  });

  it('does not mark the outer edge of the map', () => {
    const map = grid(1, 1, 5);
    expect(terrainContourEdges(map, 0, 0)).toBe(0);
  });

  it('re-indexes world edges to view edges by rotation', () => {
    const map = grid(2, 1, 2);
    map.heights[1] = 4;
    // world edge 1 of tile (0,0); view edge index = (1 - top) & 3, top = (4 - rotation) & 3
    expect(terrainContourViewEdges(map, 0, 0, 0)).toBe(0b0010);
    expect(terrainContourViewEdges(map, 0, 0, 1)).toBe(0b0100);
    expect(terrainContourViewEdges(map, 0, 0, 2)).toBe(0b1000);
    expect(terrainContourViewEdges(map, 0, 0, 3)).toBe(0b0001);
  });
});

describe('terrain edge face bases', () => {
  const map = {
    width: 3,
    height: 3,
    heights: new Uint8Array([4, 4, 4, 4, 4, 1, 4, 4, 4]),
    slope: new Uint8Array(9),
  };

  it('uses the neighbour edge height, and sea level beyond the map border', () => {
    expect(terrainNeighborEdgeBase(map, 0, 1, 0)).toBe(4);
    expect(terrainNeighborEdgeBase(map, 1, 1, 0)).toBe(1);
    expect(terrainNeighborEdgeBase(map, 2, 1, 0)).toBe(0);
    expect(terrainNeighborEdgeBase(map, 0, 0, 3)).toBe(0);
  });

  it('takes the lowest corner of a sloped neighbour edge', () => {
    const sloped = { ...map, slope: new Uint8Array([0, 0, 0, 0, 0, 0b0011, 0, 0, 0]) };
    expect(terrainNeighborEdgeBase(sloped, 1, 1, 0)).toBe(1);
    const edgeUp = { ...map, slope: new Uint8Array([0, 0, 0, 0, 0, 0b1001, 0, 0, 0]) };
    expect(terrainNeighborEdgeBase(edgeUp, 1, 1, 0)).toBe(2);
  });

  it('shows only the edges that turn toward the viewer', () => {
    expect([0, 1, 2, 3].filter((d) => terrainEdgeFacesViewer(d, 0))).toEqual([0, 1]);
    expect([0, 1, 2, 3].filter((d) => terrainEdgeFacesViewer(d, 1))).toEqual([0, 3]);
    expect([0, 1, 2, 3].filter((d) => terrainEdgeFacesViewer(d, 2))).toEqual([2, 3]);
  });
});
