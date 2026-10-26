import { describe, expect, it } from 'vitest';
import { PathFlag } from '../sim/map/tile-map';
import { Z_STEP } from '../sim/core/constants';
import {
  pathAdditionEdgeGroundZ,
  pathAdditionEdges,
  pathAdditionEdgeOffset,
  pathAdditionView,
  pathAdditionBox,
  pathAdditionGroundZ,
  adjustDepthForGroundZ,
  sceneryGroundZ,
  spriteAnchorScreenShift,
} from './ground-anchor';

describe('ground anchors', () => {
  it.each([
    ['straight', 0b0101, [1]],
    ['corner', 0b0011, [2]],
    ['T-junction', 0b0111, [3]],
    ['crossroads', 0b1111, []],
    ['dead-end', 0b0001, [1]],
  ])('places %s additions on the lowest open edge', (_shape, connections, expected) => {
    expect(pathAdditionEdges(connections)).toEqual(expected);
  });

  it('rotates each edge placement with the camera view', () => {
    for (let rotation = 0; rotation < 4; rotation++)
      for (let edge = 0; edge < 4; edge++)
        expect(pathAdditionView(edge, rotation)).toBe((edge + rotation) & 3);
  });

  it('offsets additions to open edges and follows the slope surface there', () => {
    expect(pathAdditionEdgeOffset(0)).toEqual({ x: 96, y: 0 });
    expect(pathAdditionEdgeOffset(1)).toEqual({ x: 0, y: 96 });
    const rampEast = PathFlag.Sloped;
    expect(pathAdditionEdgeGroundZ(3, rampEast, 0)).toBe(3 * Z_STEP + Z_STEP + 1);
    expect(pathAdditionEdgeGroundZ(3, rampEast, 1)).toBe(3 * Z_STEP + Z_STEP / 2 + 1);
    expect(pathAdditionEdgeGroundZ(3, rampEast, 2)).toBe(3 * Z_STEP + 1);
  });

  it('keeps painter depth aligned with the anchored surface elevation', () => {
    expect(adjustDepthForGroundZ(10, 2, 2 * Z_STEP)).toBe(10);
    expect(adjustDepthForGroundZ(10, 2, 2 * Z_STEP + Z_STEP / 2)).toBe(9.5);
  });

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

  it('keeps trimmed sprite ground pivots aligned after scaling', () => {
    expect(spriteAnchorScreenShift(128, 70, 40)).toBe(-1.875);
    expect(spriteAnchorScreenShift(128, 64, 40)).toBe(0);
  });
});
