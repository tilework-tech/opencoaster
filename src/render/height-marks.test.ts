import { describe, expect, it } from 'vitest';
import { heightMarkPlacements, heightMarkStep } from './height-marks';
import type { HeightMarkMap } from './height-marks';
import { TILE_H, Z_PIXELS, worldToScreen } from './projection';

function flatMap(width: number, height: number, level: number): HeightMarkMap {
  return {
    width,
    height,
    heights: new Uint8Array(width * height).fill(level),
    slope: new Uint8Array(width * height),
  };
}

const viewport = { width: 400, height: 300 };

function centred(map: HeightMarkMap, x: number, y: number, z: number, rotation: 0 | 1 | 2 | 3 = 0) {
  const [cx, cy] = worldToScreen(x + 0.5, y + 0.5, z, rotation, map);
  return { x: cx, y: cy, zoom: 1, rotation };
}

describe('heightMarkPlacements', () => {
  it('puts a tile label at the centre of the tile surface, at its base height', () => {
    const map = flatMap(8, 8, 4);
    const marks = heightMarkPlacements(map, centred(map, 3, 3, 4), viewport);
    const mark = marks.find((m) => m.text === '4' && m.x === 200 && m.y === 150);
    expect(mark).toMatchObject({ kind: 'land' });
  });

  it('lifts a label by the tile height, one level per Z_PIXELS', () => {
    const map = flatMap(8, 8, 2);
    map.heights[3 * 8 + 3] = 5;
    const camera = centred(map, 3, 3, 2);
    const mark = heightMarkPlacements(map, camera, viewport).find((m) => m.text === '5')!;
    expect(mark.y).toBe(150 - 3 * Z_PIXELS);
  });

  it('rests a label on the mean surface of a sloped tile but still reads the base height', () => {
    const map = flatMap(8, 8, 0);
    map.heights[3 * 8 + 3] = 2;
    map.slope[3 * 8 + 3] = 0b1111;
    const camera = centred(map, 3, 3, 3);
    const mark = heightMarkPlacements(map, camera, viewport).find((m) => m.text === '2')!;
    expect(mark.y).toBe(150);
  });

  it('drops labels that are off screen', () => {
    const map = flatMap(8, 8, 0);
    const far = { x: 10_000, y: 10_000, zoom: 1, rotation: 0 as const };
    expect(heightMarkPlacements(map, far, viewport)).toEqual([]);
  });

  it('labels every tile at default zoom and thins them out when zoomed out', () => {
    const map = flatMap(6, 6, 1);
    const at = (zoom: number) =>
      heightMarkPlacements(map, { ...centred(map, 3, 3, 1), zoom }, viewport).length;
    expect(heightMarkStep(1)).toBe(1);
    expect(at(1)).toBe(36);
    expect(at(0.5)).toBe(9);
  });

  it('shows the path level in place of the land number under a path', () => {
    const map = flatMap(8, 8, 4);
    map.pathElements = Int32Array.from([3, 3, 4, 0, 0, 0]);
    map.pathCount = 1;
    const marks = heightMarkPlacements(map, centred(map, 3, 3, 4), viewport);
    expect(marks.filter((m) => m.kind === 'path')).toEqual([
      { x: 200, y: 150, text: '4', kind: 'path' },
    ]);
    expect(marks.some((m) => m.kind === 'land' && m.x === 200 && m.y === 150)).toBe(false);
  });

  it('shows the water level at the surface of a flooded tile', () => {
    const map = flatMap(8, 8, 1);
    map.waterLevel = new Uint8Array(64);
    map.waterLevel[3 * 8 + 3] = 3;
    const marks = heightMarkPlacements(map, centred(map, 3, 3, 3), viewport);
    expect(marks.find((m) => m.kind === 'water')).toMatchObject({ text: '3', x: 200, y: 150 });
  });

  it('follows the camera rotation', () => {
    const map = flatMap(8, 8, 0);
    map.heights[1 * 8 + 5] = 7;
    for (const rotation of [0, 1, 2, 3] as const) {
      const camera = centred(map, 5, 1, 7, rotation);
      const mark = heightMarkPlacements(map, camera, viewport).find((m) => m.text === '7')!;
      expect(mark.x).toBe(200);
      expect(mark.y).toBe(150);
    }
  });

  it('keeps labels inside the tile diamond so neighbours do not overlap', () => {
    const map = flatMap(8, 8, 0);
    const marks = heightMarkPlacements(map, centred(map, 3, 3, 0), viewport);
    const a = marks.find((m) => m.x === 200 && m.y === 150)!;
    const neighbour = marks.find((m) => m.x === 232 && m.y === 150 + TILE_H / 2)!;
    expect(neighbour).toBeDefined();
    expect(Math.hypot(neighbour.x - a.x, neighbour.y - a.y)).toBeGreaterThan(30);
  });
});
