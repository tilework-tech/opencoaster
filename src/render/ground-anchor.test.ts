import { describe, expect, it } from 'vitest';
import { PathFlag } from '../sim/map/tile-map';
import { Z_STEP } from '../sim/core/constants';
import { flowerbedPreviewGhost } from '../app/tools/flowerbed-preview';
import {
  pathAdditionEdgeGroundZ,
  pathAdditionPlacements,
  pathAdditionEdgeOffset,
  pathAdditionView,
  pathAdditionBox,
  pathAdditionGroundZ,
  adjustDepthForGroundZ,
  flowerBedGroundZ,
  sceneryGroundZ,
  spriteAnchorScreenShift,
} from './ground-anchor';

describe('ground anchors', () => {
  const lampShape = PathFlag.Lamp;
  const count = (flags: number, connections: number) =>
    pathAdditionPlacements(flags | connections, 3).length;

  it.each([
    ['straight', 0b0101, 2],
    ['corner', 0b0011, 2],
    ['T-junction', 0b0111, 1],
    ['crossroads', 0b1111, 0],
    ['dead-end', 0b0001, 3],
  ])('places %s benches and bins on every open edge', (_shape, connections, expected) => {
    expect(count(PathFlag.Bench, connections)).toBe(expected);
    expect(count(PathFlag.Bin, connections)).toBe(expected);
  });

  it('places lamps like other additions, except four corner posts on a crossroads', () => {
    expect(count(lampShape, 0b0101)).toBe(2);
    expect(count(lampShape, 0b0111)).toBe(1);
    const posts = pathAdditionPlacements(lampShape | 0b1111, 3);
    expect(posts).toHaveLength(4);
    expect(posts.map((p) => [Math.sign(p.x), Math.sign(p.y)]).sort()).toEqual(
      [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ].sort(),
    );
  });

  it('keeps every copy inside its tile on the open edge, never on a connected one', () => {
    for (let connections = 0; connections < 16; connections++)
      for (const flag of [PathFlag.Bench, PathFlag.Bin, PathFlag.Lamp]) {
        const placements = pathAdditionPlacements(flag | connections, 0);
        for (const p of placements) {
          expect(Math.abs(p.x)).toBeLessThan(128);
          expect(Math.abs(p.y)).toBeLessThan(128);
          if (connections !== 15) expect(connections & (1 << p.edge)).toBe(0);
        }
      }
  });

  it('keeps copies apart in every rotation', () => {
    for (let connections = 0; connections < 16; connections++)
      for (let rotation = 0; rotation < 4; rotation++) {
        const placements = pathAdditionPlacements(PathFlag.Bench | connections, 0);
        for (let a = 0; a < placements.length; a++)
          for (let b = a + 1; b < placements.length; b++) {
            const dx = placements[a]!.x - placements[b]!.x;
            const dy = placements[a]!.y - placements[b]!.y;
            expect(Math.hypot(dx, dy)).toBeGreaterThan(96);
            expect(pathAdditionView(placements[a]!.edge, rotation)).toBeGreaterThanOrEqual(0);
          }
      }
  });

  it('follows the slope surface at each placement of a sloped path', () => {
    const placements = pathAdditionPlacements(PathFlag.Bench | PathFlag.Sloped | 0b0101, 3);
    expect(placements.map((p) => p.edge)).toEqual([1, 3]);
    for (const p of placements)
      expect(p.groundZ).toBe(pathAdditionEdgeGroundZ(3, PathFlag.Bench | PathFlag.Sloped, p.edge));
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

  it('anchors the flowerbed placement preview at the terrain surface in every view', () => {
    for (let slopeMask = 0; slopeMask < 16; slopeMask++)
      for (let rotation = 0; rotation < 4; rotation++) {
        const groundZ = flowerBedGroundZ(2, slopeMask, rotation);
        const preview = flowerbedPreviewGhost(3, 4, 2, slopeMask, rotation);
        expect(preview.level * Z_STEP, `slope=${slopeMask} rotation=${rotation}`).toBe(groundZ);
      }
  });

  it('keeps trimmed sprite ground pivots aligned after scaling', () => {
    expect(spriteAnchorScreenShift(128, 70, 40)).toBe(-1.875);
    expect(spriteAnchorScreenShift(128, 64, 40)).toBe(0);
  });
});
