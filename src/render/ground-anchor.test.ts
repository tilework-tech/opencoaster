import { describe, expect, it } from 'vitest';
import { PathFlag } from '../sim/map/tile-map';
import { Z_STEP } from '../sim/core/constants';
import { pathAdditionBox, pathAdditionGroundZ, sceneryGroundZ } from './ground-anchor';

describe('ground anchors', () => {
  it('places path additions at the path surface for flat and sloped paths', () => {
    const flat = pathAdditionGroundZ(3, PathFlag.Bench);
    const sloped = pathAdditionGroundZ(3, PathFlag.Bench | PathFlag.Sloped);
    expect(flat).toBeGreaterThan(3 * Z_STEP);
    expect(sloped - flat).toBe(Z_STEP / 2 - 1);
  });

  it('uses one shared render box for intact and vandalised path additions', () => {
    expect(pathAdditionBox(PathFlag.Bench)).toEqual({ width: 30, height: 18 });
    expect(pathAdditionBox(PathFlag.Bin)).toEqual({ width: 18, height: 26 });
    expect(pathAdditionBox(PathFlag.Lamp)).toEqual({ width: 16, height: 32 });
    expect(pathAdditionBox(PathFlag.Shelter).width).toBeGreaterThan(0);
  });

  it('matches rendered terrain height at a tile centre for every view rotation', () => {
    const heights = [
      sceneryGroundZ(2, 0b0101, 0),
      sceneryGroundZ(2, 0b0101, 1),
      sceneryGroundZ(2, 0b0101, 2),
      sceneryGroundZ(2, 0b0101, 3),
    ];
    expect(heights).toEqual([2 * Z_STEP, 3 * Z_STEP, 2 * Z_STEP, 3 * Z_STEP]);
  });
});
