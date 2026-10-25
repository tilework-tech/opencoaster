import { describe, expect, it } from 'vitest';
import { project } from '../../render/projection';
import type { Rotation } from '../../render/projection';
import { TILE_UNITS, Z_STEP } from '../../sim/core/constants';
import { pickLandSelection } from './land-selection';

const SIZE = 16;
const map = {
  width: SIZE,
  height: SIZE,
  heights: new Uint8Array(SIZE * SIZE).fill(4),
  slope: new Uint8Array(SIZE * SIZE),
};
const viewport = { width: 1000, height: 700 };

/** Screen position of the point (tx, ty) in tile units on flat ground at level 4. */
function screenAt(tx: number, ty: number, rotation: Rotation, zoom = 2) {
  const camera = { x: 0, y: 200, zoom, rotation };
  const out = new Float64Array(2);
  project(tx * TILE_UNITS, ty * TILE_UNITS, 4 * Z_STEP, SIZE, SIZE, rotation, out);
  return {
    camera,
    x: viewport.width / 2 + (out[0] - camera.x) * zoom,
    y: viewport.height / 2 + (out[1] - camera.y) * zoom,
  };
}

describe('pickLandSelection', () => {
  for (const rotation of [0, 1, 2, 3] as Rotation[]) {
    it(`snaps a size-1 pick to a corner, an edge or the whole tile (rotation ${rotation})`, () => {
      const pick = (fx: number, fy: number) => {
        const p = screenAt(5 + fx, 6 + fy, rotation);
        return pickLandSelection(p.x, p.y, map, p.camera, viewport, 1, true);
      };
      expect(pick(0.08, 0.08)).toMatchObject({ x: 5, y: 6, corners: 0b0001 });
      expect(pick(0.92, 0.08)).toMatchObject({ corners: 0b0010 });
      expect(pick(0.92, 0.92)).toMatchObject({ corners: 0b0100 });
      expect(pick(0.08, 0.92)).toMatchObject({ corners: 0b1000 });
      expect(pick(0.5, 0.06)).toMatchObject({ corners: 0b0011 });
      expect(pick(0.94, 0.5)).toMatchObject({ corners: 0b0110 });
      expect(pick(0.5, 0.94)).toMatchObject({ corners: 0b1100 });
      expect(pick(0.06, 0.5)).toMatchObject({ corners: 0b1001 });
      expect(pick(0.5, 0.5)).toMatchObject({ x: 5, y: 6, corners: 0b1111 });
    });
  }

  it('always selects whole tiles when corner snapping is off', () => {
    const p = screenAt(5.05, 6.05, 0);
    expect(pickLandSelection(p.x, p.y, map, p.camera, viewport, 1, false)?.corners).toBe(0b1111);
  });

  it('centres larger squares on the picked tile', () => {
    const p = screenAt(5.5, 6.5, 0);
    expect(pickLandSelection(p.x, p.y, map, p.camera, viewport, 3, true)).toMatchObject({
      x: 4,
      y: 5,
      width: 3,
      height: 3,
      cursorX: 5,
      cursorY: 6,
      corners: 0b1111,
    });
  });

  it('picks the higher tile in front, not a lower one behind it', () => {
    const raised = { ...map, heights: map.heights.slice() };
    raised.heights[6 * SIZE + 5] = 4;
    raised.heights[5 * SIZE + 5] = 2;
    const p = screenAt(5.5, 6.08, 0);
    expect(pickLandSelection(p.x, p.y, raised, p.camera, viewport, 1, false)).toMatchObject({
      cursorX: 5,
      cursorY: 6,
    });
  });

  it('returns null away from the map', () => {
    expect(
      pickLandSelection(5, 5, map, { x: 9000, y: 9000, zoom: 1, rotation: 0 }, viewport, 1, true),
    ).toBeNull();
  });
});
