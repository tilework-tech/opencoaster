import { describe, expect, it } from 'vitest';
import { Z_STEP } from '../sim/core/constants';
import type { Camera, MapData } from '../render/renderer';
import { project } from '../render/projection';
import {
  getCenterFocusElevation,
  rotateCameraAroundWorldPoint,
  rotateCameraAtCenter,
} from './camera-controls';
import { PathFlag } from '../sim/map/tile-map';
import { ZOOM_LEVELS } from '../ui/zoom';

const map: MapData = {
  width: 12,
  height: 9,
  heights: new Uint8Array(12 * 9),
  surface: new Uint8Array(12 * 9),
  slope: new Uint8Array(12 * 9),
};

function cameraAt(x: number, y: number, z: number, zoom: number, rotation: Camera['rotation']) {
  const projected = new Float64Array(2);
  project(x, y, z, map.width, map.height, rotation, projected);
  return { x: projected[0], y: projected[1], z, zoom, rotation };
}

describe('camera rotation focus', () => {
  it.each(ZOOM_LEVELS)(
    'keeps an elevated world point fixed through repeated turns at zoom %s',
    (zoom) => {
      const focus = { x: 5.25 * 256, y: 3.75 * 256, z: 7 * Z_STEP };
      for (const initialRotation of [0, 1, 2, 3] as const) {
        const camera = cameraAt(focus.x, focus.y, focus.z, zoom, initialRotation);
        const start = { x: camera.x, y: camera.y };
        for (let turn = 0; turn < 4; turn++) rotateCameraAroundWorldPoint(camera, map, 1, focus.z);
        expect(camera.rotation).toBe(initialRotation);
        expect(camera.x).toBeCloseTo(start.x, 10);
        expect(camera.y).toBeCloseTo(start.y, 10);
        for (let turn = 0; turn < 4; turn++) rotateCameraAroundWorldPoint(camera, map, -1, focus.z);
        expect(camera.rotation).toBe(initialRotation);
        expect(camera.x).toBeCloseTo(start.x, 10);
        expect(camera.y).toBeCloseTo(start.y, 10);
      }
    },
  );

  it('preserves a raised point across all view orientations', () => {
    const focus = { x: 3.5 * 256, y: 6.25 * 256, z: 11 * Z_STEP };
    const camera = cameraAt(focus.x, focus.y, focus.z, 1, 0);

    for (const rotation of [1, 2, 3] as const) {
      rotateCameraAroundWorldPoint(camera, map, 1, focus.z);
      const projected = new Float64Array(2);
      project(focus.x, focus.y, focus.z, map.width, map.height, rotation, projected);
      expect(camera.rotation).toBe(rotation);
      expect(camera.x).toBeCloseTo(projected[0], 10);
      expect(camera.y).toBeCloseTo(projected[1], 10);
    }
  });

  it('uses terrain height under viewport center as the focus elevation', () => {
    const hillMap = { ...map, heights: new Uint8Array(map.width * map.height) };
    hillMap.heights[4 * map.width + 5] = 6;
    const camera = cameraAt(5.5 * 256, 4.5 * 256, 6 * Z_STEP, 1, 0);
    expect(getCenterFocusElevation(hillMap, camera, { width: 800, height: 600 })).toBe(6 * Z_STEP);
  });

  it('uses the interpolated surface height at the centre of a sloped terrain tile', () => {
    const slopeMap = {
      ...map,
      heights: new Uint8Array(map.width * map.height),
      slope: new Uint8Array(map.width * map.height),
    };
    slopeMap.heights[4 * map.width + 5] = 6;
    slopeMap.slope[4 * map.width + 5] = 1;
    const camera = cameraAt(5.5 * 256, 4.5 * 256, 6 * Z_STEP, 1, 0);
    expect(getCenterFocusElevation(slopeMap, camera, { width: 800, height: 600 })).toBe(
      6.25 * Z_STEP,
    );
  });

  it('uses a raised path surface above the terrain as the focus elevation', () => {
    const pathMap = {
      ...map,
      pathElements: Int32Array.of(5, 4, 8, PathFlag.Sloped, 0, 0),
      pathCount: 1,
    };
    const camera = cameraAt(5.5 * 256, 4.5 * 256, 8.5 * Z_STEP, 1, 0);
    expect(getCenterFocusElevation(pathMap, camera, { width: 800, height: 600 })).toBe(
      8.5 * Z_STEP,
    );
  });

  it('uses coaster track height above terrain and paths as the focus elevation', () => {
    const camera = cameraAt(5.5 * 256, 4.5 * 256, 12 * Z_STEP, 1, 0);
    const snapshot = {
      tracks: { count: 1, data: Int32Array.of(5.5 * 256, 4.5 * 256, 12 * Z_STEP, 0) },
    };
    expect(getCenterFocusElevation(map, camera, { width: 800, height: 600 }, snapshot)).toBe(
      12 * Z_STEP,
    );
  });

  it.each(['hill', 'raised path', 'coaster track'])(
    'keeps the selected %s surface centered while rotating',
    (surface) => {
      const focus = { x: 5.5 * 256, y: 4.5 * 256 };
      let focusMap = map;
      let snapshot: { tracks: { count: number; data: Int32Array } } | undefined;
      const elevation =
        surface === 'hill' ? 6 * Z_STEP : surface === 'raised path' ? 8.5 * Z_STEP : 12 * Z_STEP;
      if (surface === 'hill') {
        const heights = map.heights.slice();
        heights[4 * map.width + 5] = 6;
        focusMap = { ...map, heights };
      } else if (surface === 'raised path') {
        focusMap = {
          ...map,
          pathElements: Int32Array.of(5, 4, 8, PathFlag.Sloped, 0, 0),
          pathCount: 1,
        };
      } else {
        snapshot = {
          tracks: { count: 1, data: Int32Array.of(focus.x, focus.y, 12 * Z_STEP, 0) },
        };
      }
      const camera = cameraAt(focus.x, focus.y, elevation, 2, 0);
      for (let turn = 1; turn <= 4; turn++) {
        rotateCameraAtCenter(camera, focusMap, 1, { width: 800, height: 600 }, snapshot);
        const expected = new Float64Array(2);
        project(
          focus.x,
          focus.y,
          elevation,
          map.width,
          map.height,
          (turn % 4) as 0 | 1 | 2 | 3,
          expected,
        );
        expect(camera.x).toBeCloseTo(expected[0], 10);
        expect(camera.y).toBeCloseTo(expected[1], 10);
      }
    },
  );
});
