import { describe, expect, it } from 'vitest';
import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { PathFlag } from '../sim/map/tile-map';
import {
  SOLID_BIAS,
  SurfaceDepths,
  pathSlabDepth,
  personDepth,
  rotatedPositionSum,
  terrainDepth,
} from './depth-key';
import type { Rotation } from './projection';
import type { MapData } from './renderer';

const SIZE = 16;
const ROTATIONS: Rotation[] = [0, 1, 2, 3];

interface Piece {
  x: number;
  y: number;
  base: number;
  flags?: number;
}

function mapWith(pieces: Piece[], ground = 2): MapData {
  const pathElements = new Int32Array(pieces.length * 6);
  pieces.forEach((piece, index) => {
    pathElements.set([piece.x, piece.y, piece.base, piece.flags ?? 0, 0, 0], index * 6);
  });
  return {
    width: SIZE,
    height: SIZE,
    heights: new Uint8Array(SIZE * SIZE).fill(ground),
    surface: new Uint8Array(SIZE * SIZE),
    slope: new Uint8Array(SIZE * SIZE),
    pathElements,
    pathCount: pieces.length,
  };
}

function person(map: MapData, rotation: Rotation, x: number, y: number, z: number): number {
  const surfaces = new SurfaceDepths();
  surfaces.prepare(map, rotation);
  return personDepth(map, rotation, surfaces, x * TILE_UNITS, y * TILE_UNITS, z * Z_STEP);
}

function slab(map: MapData, rotation: Rotation, piece: Piece): number {
  return pathSlabDepth(
    map,
    rotation,
    piece.x,
    piece.y,
    piece.base,
    piece.flags ?? 0,
    map.heights[piece.y * SIZE + piece.x]!,
  );
}

const SLOPE_UP_X = PathFlag.Sloped | (0 << 10);
const SLOPE_UP_Y = PathFlag.Sloped | (1 << 10);
const SLOPE_DOWN_X = PathFlag.Sloped | (2 << 10);
const SLOPE_DOWN_Y = PathFlag.Sloped | (3 << 10);

describe('people against the path they stand on', () => {
  for (const rotation of ROTATIONS) {
    it(`draw after a flat slab at every spot of the tile (rotation ${rotation})`, () => {
      const piece = { x: 8, y: 8, base: 2 };
      const map = mapWith([piece]);
      for (const fx of [0.01, 0.25, 0.5, 0.75, 0.99])
        for (const fy of [0.01, 0.25, 0.5, 0.75, 0.99])
          expect(person(map, rotation, 8 + fx, 8 + fy, 2)).toBeGreaterThan(
            slab(map, rotation, piece),
          );
    });

    for (const [name, flags, zAt] of [
      ['up +x', SLOPE_UP_X, (fx: number) => 2 + fx],
      ['up +y', SLOPE_UP_Y, (_fx: number, fy: number) => 2 + fy],
      ['down +x', SLOPE_DOWN_X, (fx: number) => 3 - fx],
      ['down +y', SLOPE_DOWN_Y, (_fx: number, fy: number) => 3 - fy],
    ] as const) {
      it(`draw after a ramp rising ${name} along its whole length (rotation ${rotation})`, () => {
        const piece = { x: 8, y: 8, base: 2, flags };
        const map = mapWith([piece]);
        for (const fx of [0.01, 0.5, 0.99])
          for (const fy of [0.01, 0.5, 0.99])
            expect(person(map, rotation, 8 + fx, 8 + fy, zAt(fx, fy))).toBeGreaterThan(
              slab(map, rotation, piece),
            );
      });
    }

    it(`draw after a raised slab on level and on sunken ground (rotation ${rotation})`, () => {
      for (const base of [3, 4, 6]) {
        const piece = { x: 8, y: 8, base };
        const map = mapWith([piece]);
        for (const fx of [0.05, 0.95])
          for (const fy of [0.05, 0.95])
            expect(person(map, rotation, 8 + fx, 8 + fy, base)).toBeGreaterThan(
              slab(map, rotation, piece),
            );
      }
    });

    it(`draw after the next slab at their feet level when at its edge (rotation ${rotation})`, () => {
      const ramp = { x: 7, y: 8, base: 2, flags: SLOPE_UP_X };
      const top = { x: 8, y: 8, base: 3 };
      const map = mapWith([ramp, top]);
      expect(person(map, rotation, 7.97, 8.5, 2.97)).toBeGreaterThan(slab(map, rotation, top));
    });

    it(`draw after terrain on every tile (rotation ${rotation})`, () => {
      const map = mapWith([]);
      for (const fx of [0.05, 0.95])
        for (const fy of [0.05, 0.95])
          expect(person(map, rotation, 5 + fx, 5 + fy, 2)).toBeGreaterThan(
            terrainDepth(map, rotation, 5, 5, 2),
          );
    });

    it(`take no floor from a slab above them, such as a bridge deck (rotation ${rotation})`, () => {
      const map = mapWith([{ x: 8, y: 8, base: 6 }]);
      const own = 2 * rotatedPositionSum(8.1 * TILE_UNITS, 8.1 * TILE_UNITS, map, rotation) - 2;
      expect(person(map, rotation, 8.1, 8.1, 2)).toBeCloseTo(own + 0.5, 5);
    });
  }
});

describe('people against tile-sized objects', () => {
  const solid = (map: MapData, rotation: Rotation, tx: number, ty: number): number =>
    2 *
      rotatedPositionSum(
        tx * TILE_UNITS + TILE_UNITS / 2,
        ty * TILE_UNITS + TILE_UNITS / 2,
        map,
        rotation,
      ) -
    2 +
    SOLID_BIAS;

  for (const rotation of ROTATIONS) {
    it(`are behind an object one tile nearer the camera and in front of one a tile farther (rotation ${rotation})`, () => {
      const map = mapWith([]);
      // One step toward the camera in view space: +x for rotations 0 and 1, -x for 2 and 3 ... as
      // measured by the rotated position sum itself.
      const steps: Array<[number, number]> = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ];
      for (const [dx, dy] of steps) {
        const tree = solid(map, rotation, 8, 8);
        const nearer =
          rotatedPositionSum((8.5 + dx) * TILE_UNITS, (8.5 + dy) * TILE_UNITS, map, rotation) >
          rotatedPositionSum(8.5 * TILE_UNITS, 8.5 * TILE_UNITS, map, rotation);
        const spot = person(map, rotation, 8.5 + dx * 0.75, 8.5 + dy * 0.75, 2);
        if (nearer) expect(spot).toBeGreaterThan(tree);
        else expect(spot).toBeLessThan(tree);
      }
    });
  }
});
