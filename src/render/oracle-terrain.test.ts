import { describe, expect, it } from 'vitest';
import { compositeScene } from './occlusion-oracle';
import { GROUND_OBJECT_ID, WATER_OBJECT_ID } from './object-kinds';
import { worldToScreen } from './projection';
import type { Rotation } from './projection';
import type { Camera, MapData } from './renderer';
import { terrainTriangles } from './oracle-terrain';

function flatMap(size: number, height: number): MapData {
  const count = size * size;
  return {
    width: size,
    height: size,
    heights: new Uint8Array(count).fill(height),
    surface: new Uint8Array(count),
    slope: new Uint8Array(count),
    ownership: new Uint8Array(count).fill(1),
    waterLevel: new Uint8Array(count),
    pathElements: new Int32Array(0),
    pathCount: 0,
    sceneryElements: new Int32Array(0),
    sceneryCount: 0,
  };
}

const VIEW = 400;

function sample(map: MapData, camera: Camera, x: number, y: number, z: number) {
  const result = compositeScene({
    width: VIEW,
    height: VIEW,
    pages: [],
    sprites: [],
    triangles: terrainTriangles(map, camera, VIEW, VIEW, 1),
  });
  const [sx, sy] = worldToScreen(x, y, z, camera.rotation, map);
  const px = Math.floor((sx - camera.x) * camera.zoom + VIEW / 2);
  const py = Math.floor((sy - camera.y) * camera.zoom + VIEW / 2);
  return { id: result.ids[py * VIEW + px], height: result.heights[py * VIEW + px] };
}

describe('oracle terrain', () => {
  for (const rotation of [0, 1, 2, 3] as Rotation[]) {
    it(`gives every point of the ground its own height (rotation ${rotation})`, () => {
      const map = flatMap(6, 2);
      map.heights[2 * 6 + 3] = 4;
      const camera: Camera = { x: 0, y: 100, zoom: 1, rotation };
      const flat = sample(map, camera, 1.3, 4.6, 2);
      expect(flat.id).toBe(GROUND_OBJECT_ID);
      expect(flat.height).toBeCloseTo(2, 1);
      const raised = sample(map, camera, 3.5, 2.5, 4);
      expect(raised.height).toBeCloseTo(4, 1);
    });
  }

  it('draws a cliff face down from a raised tile on the sides that face the viewer', () => {
    const map = flatMap(6, 2);
    map.heights[2 * 6 + 3] = 4;
    // Tile (3, 2) seen from rotation 0: its +y edge faces the viewer; a point on that face.
    const face = sample(map, { x: 0, y: 100, zoom: 1, rotation: 0 }, 3.5, 3, 3);
    expect(face.id).toBe(GROUND_OBJECT_ID);
    expect(face.height).toBeCloseTo(3, 1);
  });

  it('covers flooded ground with a water surface', () => {
    const map = flatMap(6, 2);
    map.waterLevel![2 * 6 + 2] = 3;
    const water = sample(map, { x: 0, y: 100, zoom: 1, rotation: 0 }, 2.5, 2.5, 3);
    expect(water.id).toBe(WATER_OBJECT_ID);
  });
});
