import { describe, expect, it } from 'vitest';
import {
  pickTile,
  project,
  rotateDirection,
  rotateFootprint,
  rotateOffset,
  rotatePoint,
  rotateTile,
  screenToWorld,
  unrotateTile,
  worldToScreen,
} from './projection';
import type { Rotation } from './projection';
import { terrainMeshTriangles, terrainTileCorners } from './terrain-geometry';

describe('projection', () => {
  it('unrotateTile inverts rotateTile for every rotation on a non-square map', () => {
    for (const rot of [0, 1, 2, 3] as Rotation[]) {
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 3; y++) {
          const [rx, ry] = rotateTile(x, y, 5, 3, rot);
          expect(unrotateTile(rx, ry, 5, 3, rot)).toEqual([x, y]);
        }
      }
    }
  });

  it('projects higher positions further up the screen', () => {
    const lo = new Float64Array(2);
    const hi = new Float64Array(2);
    project(256, 256, 0, 8, 8, 0, lo);
    project(256, 256, 128, 8, 8, 0, hi);
    expect(hi[1]).toBeLessThan(lo[1]);
    expect(hi[0]).toBe(lo[0]);
  });

  it('picks the tile under its projected centre at every rotation and zoom level', () => {
    const map = { width: 8, height: 5, heights: new Uint8Array(40), surface: new Uint8Array(40) };
    const target: [number, number] = [6, 1];
    map.heights[target[1] * map.width + target[0]] = 3;
    const camera = { x: 24, y: 12, zoom: 1.5, rotation: 0 as Rotation };
    const viewport = { width: 800, height: 600 };
    const point = new Float64Array(2);

    for (const rotation of [0, 1, 2, 3] as Rotation[]) {
      camera.rotation = rotation;
      for (const zoom of [0.5, 1, 1.5, 2]) {
        camera.zoom = zoom;
        project(
          (target[0] + 0.5) * 256,
          (target[1] + 0.5) * 256,
          3 * 64,
          map.width,
          map.height,
          rotation,
          point,
        );
        const screenX = viewport.width / 2 + (point[0] - camera.x) * camera.zoom;
        const screenY = viewport.height / 2 + (point[1] - camera.y) * camera.zoom;
        expect(
          pickTile(screenX, screenY, map, camera, viewport),
          `rotation ${rotation}, zoom ${zoom}`,
        ).toEqual(target);
      }
    }
  });

  it('picks the visible terrain tile on raised and sloped surfaces at every rotation and zoom', () => {
    const map = {
      width: 8,
      height: 6,
      heights: new Uint8Array(48),
      slope: new Uint8Array(48),
    };
    const target: [number, number] = [3, 2];
    const index = target[1] * map.width + target[0];
    map.heights[index] = 4;
    map.slope[index] = 0b0101;
    const camera = { x: 0, y: 0, zoom: 1, rotation: 0 as Rotation };
    const viewport = { width: 800, height: 600 };
    const point = new Float64Array(2);
    const corners = terrainTileCorners(target[0], target[1], 4, map.slope[index]);

    for (const rotation of [0, 1, 2, 3] as Rotation[]) {
      camera.rotation = rotation;
      for (const zoom of [0.5, 1, 1.5, 2]) {
        camera.zoom = zoom;
        for (const triangle of terrainMeshTriangles(rotation)) {
          const sample = [0.4, 0.3, 0.3];
          const fx = triangle.reduce((sum, corner, i) => sum + corners[corner]!.x * sample[i]!, 0);
          const fy = triangle.reduce((sum, corner, i) => sum + corners[corner]!.y * sample[i]!, 0);
          const fz = triangle.reduce(
            (sum, corner, i) => sum + corners[corner]!.height * 64 * sample[i]!,
            0,
          );
          project(fx * 256, fy * 256, fz, map.width, map.height, rotation, point);
          const screenX = viewport.width / 2 + (point[0] - camera.x) * camera.zoom;
          const screenY = viewport.height / 2 + (point[1] - camera.y) * camera.zoom;

          expect(
            pickTile(screenX, screenY, map, camera, viewport),
            `rotation ${rotation}, zoom ${zoom}, triangle ${triangle.join(',')}`,
          ).toEqual(target);
        }
      }
    }
  });

  it('picks a lower foreground tile over raised terrain behind it', () => {
    const map = {
      width: 4,
      height: 4,
      heights: new Uint8Array(16),
      slope: new Uint8Array(16),
    };
    map.heights[map.width + 1] = 5;
    map.slope[0] = 1;
    const camera = { x: 0, y: 0, zoom: 1, rotation: 0 as Rotation };
    const viewport = { width: 800, height: 600 };

    expect(pickTile(viewport.width / 2, viewport.height / 2 - 16, map, camera, viewport)).toEqual([
      0, 0,
    ]);
  });
});

describe('canonical projection API', () => {
  const rotations: Rotation[] = [0, 1, 2, 3];
  const map = { width: 9, height: 5 };

  it('worldToScreen and screenToWorld are exact inverses at every rotation and height', () => {
    for (const rot of rotations) {
      for (const z of [0, 2.5, 7]) {
        const [sx, sy] = worldToScreen(3.25, 1.75, z, rot, map);
        const [x, y] = screenToWorld(sx, sy, z, rot, map);
        expect(x).toBeCloseTo(3.25, 9);
        expect(y).toBeCloseTo(1.75, 9);
      }
    }
  });

  it('rotateTile is the floor of rotating the tile centre', () => {
    for (const rot of rotations) {
      const [cx, cy] = rotatePoint(4.5, 2.5, map.width, map.height, rot);
      expect(rotateTile(4, 2, map.width, map.height, rot)).toEqual([
        Math.floor(cx),
        Math.floor(cy),
      ]);
    }
  });

  it('rotateOffset matches the difference of rotated points', () => {
    for (const rot of rotations) {
      const a = rotatePoint(2.5, 2.5, map.width, map.height, rot);
      const b = rotatePoint(3.5, 1.5, map.width, map.height, rot);
      expect(rotateOffset(1, -1, rot)).toEqual([b[0] - a[0], b[1] - a[1]]);
    }
  });

  it('rotateDirection turns a world direction by the same quarter turns as rotateOffset', () => {
    const steps: Array<[number, number]> = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ];
    for (const rot of rotations)
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = rotateOffset(...steps[d]!, rot);
        expect(steps[rotateDirection(d, rot)]).toEqual([dx, dy]);
      }
  });

  it('rotateFootprint keeps the cells where the map puts them', () => {
    const footprint = [
      [0, 0],
      [1, 0],
      [0, 1],
    ] as const;
    for (const rot of rotations) {
      const rotated = rotateFootprint(3, 2, footprint, map.width, map.height, rot);
      footprint.forEach(([dx, dy], i) =>
        expect(rotated.cells[i]).toEqual(rotateTile(3 + dx, 2 + dy, map.width, map.height, rot)),
      );
      expect(Math.min(...rotated.offsets.map((o) => o[0]))).toBe(0);
    }
  });
});
