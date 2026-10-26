import { describe, expect, it } from 'vitest';
import { TILE_UNITS } from '../sim/core/constants';
import { sliceMeshByDepth } from '../../tools/sprites/mesh';
import { material, quad } from '../../tools/sprites/mesh';
import {
  PERSON_BIAS,
  SOLID_BIAS,
  STRUCTURE_SLICES,
  STRUCTURE_SLICE_WIDTH,
  structureSliceDepth,
} from './depth-key';
import { rotatedPositionSum } from './depth-key';
import type { Rotation } from './projection';

const MAP = { width: 16, height: 16 };
const CENTRE = 8.5 * TILE_UNITS;
const ROTATIONS: Rotation[] = [0, 1, 2, 3];

const personKey = (x: number, y: number, rotation: Rotation): number =>
  2 * rotatedPositionSum(x * TILE_UNITS, y * TILE_UNITS, MAP, rotation) + PERSON_BIAS;
const slice = (rotation: Rotation, index: number): number =>
  structureSliceDepth(MAP, rotation, CENTRE, CENTRE, 0, index);

describe('structure depth slices', () => {
  it.each(ROTATIONS)('order a person against each slice in rotation %i', (rotation) => {
    const frontmost = STRUCTURE_SLICES - 1;
    // Nearest the camera along the view axis, a person on the tile's front edge is in front of all slices.
    const near = [
      [9, 9],
      [9, 8],
      [8, 9],
      [8, 8],
    ].map(([x, y]) => ({
      x: x!,
      y: y!,
      sum: rotatedPositionSum(x! * TILE_UNITS, y! * TILE_UNITS, MAP, rotation),
    }));
    const front = near.reduce((a, b) => (b.sum > a.sum ? b : a));
    const back = near.reduce((a, b) => (b.sum < a.sum ? b : a));
    expect(personKey(front.x, front.y, rotation)).toBeGreaterThan(slice(rotation, frontmost));
    expect(personKey(back.x, back.y, rotation)).toBeLessThanOrEqual(slice(rotation, 0));
  });

  it.each(ROTATIONS)(
    'keep objects on neighbouring tiles outside the slice range in rotation %i',
    (rotation) => {
      const solid = (x: number, y: number): number =>
        2 * rotatedPositionSum((x + 0.5) * TILE_UNITS, (y + 0.5) * TILE_UNITS, MAP, rotation) +
        SOLID_BIAS;
      for (const [x, y] of [
        [8, 8],
        [7, 8],
        [9, 8],
        [8, 7],
        [8, 9],
      ] as const) {
        const nearer = solid(x, y) > solid(8, 8) + 1.5;
        const farther = solid(x, y) < solid(8, 8) - 1.5;
        if (nearer) expect(solid(x, y)).toBeGreaterThan(slice(rotation, STRUCTURE_SLICES - 1));
        if (farther) expect(solid(x, y)).toBeLessThan(slice(rotation, 0));
      }
    },
  );

  it('cuts a mesh into non-overlapping strips along x + y', () => {
    const wall = quad(
      [
        [-0.4, 0.2, 0],
        [0.4, 0.2, 0],
        [0.4, 0.2, 1],
        [-0.4, 0.2, 1],
      ],
      material([1]),
    );
    const strips = sliceMeshByDepth(wall, STRUCTURE_SLICE_WIDTH, STRUCTURE_SLICES);
    expect(strips).toHaveLength(STRUCTURE_SLICES);
    strips.forEach((strip, index) => {
      const lower = (index - STRUCTURE_SLICES / 2) * STRUCTURE_SLICE_WIDTH;
      for (const triangle of strip)
        for (const [x, y] of triangle.v) {
          expect(x + y).toBeGreaterThanOrEqual(lower - 1e-9);
          expect(x + y).toBeLessThanOrEqual(lower + STRUCTURE_SLICE_WIDTH + 1e-9);
        }
    });
    expect(strips.filter((strip) => strip.length > 0).length).toBeGreaterThan(2);
  });
});
