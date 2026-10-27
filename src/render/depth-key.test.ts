import { describe, expect, it } from 'vitest';
import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { anchorKey } from './depth-key';
import type { Rotation } from './projection';

const map = { width: 10, height: 8 };

describe('anchorKey', () => {
  it('grows toward the camera and falls with height, the same in every rotation', () => {
    for (const rotation of [0, 1, 2, 3] as Rotation[]) {
      const keyAt = (tx: number, ty: number, levels: number) =>
        anchorKey(map, rotation, tx * TILE_UNITS, ty * TILE_UNITS, levels * Z_STEP);
      const centre = keyAt(5, 4, 0);
      // One level up is half a tile step farther along the view ray.
      expect(keyAt(5, 4, 1)).toBeCloseTo(centre - 1);
      const nearest = Math.max(keyAt(6, 4, 0), keyAt(4, 4, 0), keyAt(5, 5, 0), keyAt(5, 3, 0));
      expect(nearest).toBeCloseTo(centre + 2);
    }
  });
});
