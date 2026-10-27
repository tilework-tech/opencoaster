import { describe, expect, it } from 'vitest';
import { Z_STEP } from '../sim/core/constants';
import type { TrenchTile } from '../sim/track/trench';
import {
  TRENCH_HALF_WIDTH,
  TRENCH_WALL_STRIPS,
  surfaceHeight,
  trenchFaces,
  trenchSurfaceTriangles,
  wallStrips,
} from './trench-geometry';
import { terrainTileCorners } from './terrain-geometry';

const tile = (over: Partial<TrenchTile> = {}): TrenchTile => ({
  index: 0,
  axis: 0,
  lowZ: 5 * Z_STEP,
  highZ: 5 * Z_STEP - Z_STEP / 2,
  lowDepth: 0,
  highDepth: Z_STEP / 2,
  lowHead: false,
  highHead: false,
  ...over,
});

const area = (t: readonly { x: number; y: number }[]): number =>
  Math.abs((t[1]!.x - t[0]!.x) * (t[2]!.y - t[0]!.y) - (t[2]!.x - t[0]!.x) * (t[1]!.y - t[0]!.y)) /
  2;

describe('trench faces', () => {
  it('hangs each wall from the surface down to a floor that follows the track', () => {
    const faces = trenchFaces(tile(), 3, 4, 5, 0, 0);
    const walls = faces.filter((f) => f.kind === 'wall');
    expect(walls).toHaveLength(2);
    for (const wall of walls) {
      expect(wall.top.map((p) => p.height)).toEqual([5, 5]);
      expect(wall.bottom[0]!.height).toBeCloseTo(5, 6);
      expect(wall.bottom[1]!.height).toBeCloseTo(5 - 0.5 - 4 / Z_STEP, 6);
    }
    expect(walls.map((w) => w.top[0]!.y)).toEqual([
      4.5 - TRENCH_HALF_WIDTH,
      4.5 + TRENCH_HALF_WIDTH,
    ]);
  });

  it('adds a headwall only at ends that have one, as wide as the cut', () => {
    expect(trenchFaces(tile(), 3, 4, 5, 0, 0).some((f) => f.kind === 'head')).toBe(false);
    const faces = trenchFaces(tile({ highHead: true }), 3, 4, 5, 0, 0);
    const head = faces.find((f) => f.kind === 'head')!;
    expect(head.end).toBe(1);
    expect(head.top[0]!.x).toBe(4);
    expect(head.top[1]!.y - head.top[0]!.y).toBeCloseTo(2 * TRENCH_HALF_WIDTH, 9);
  });

  it('takes wall tops from the terrain mesh on a slope', () => {
    const mask = 0b0110;
    const corners = terrainTileCorners(3, 4, 5, mask);
    const wall = trenchFaces(tile({ axis: 1 }), 3, 4, 5, mask, 0).find((f) => f.kind === 'wall')!;
    for (const p of wall.top) expect(p.height).toBeCloseTo(surfaceHeight(corners, 0, p.x, p.y), 9);
  });

  it('splits a wall into strips with level bottoms that cover it', () => {
    const wall = trenchFaces(tile(), 3, 4, 5, 0, 0).find((f) => f.kind === 'wall')!;
    const strips = wallStrips(wall);
    expect(strips).toHaveLength(TRENCH_WALL_STRIPS);
    for (const strip of strips) expect(strip.bottom[0]!.height).toBe(strip.bottom[1]!.height);
    expect(strips[0]!.top[0]).toEqual(wall.top[0]);
    expect(strips.at(-1)!.top[1]).toEqual(wall.top[1]);
  });
});

describe('trench surface', () => {
  it('removes exactly the cut from a flat tile', () => {
    const triangles = trenchSurfaceTriangles(tile(), 3, 4, 5, 0, 0);
    const total = triangles.reduce((sum, t) => sum + area(t), 0);
    expect(total).toBeCloseTo(1 - 2 * TRENCH_HALF_WIDTH, 9);
    for (const t of triangles) for (const p of t) expect(p.height).toBe(5);
  });

  it('keeps the slope of the tile', () => {
    const mask = 0b1100;
    const corners = terrainTileCorners(3, 4, 5, mask);
    for (const rotation of [0, 1])
      for (const t of trenchSurfaceTriangles(tile(), 3, 4, 5, mask, rotation))
        for (const p of t)
          expect(p.height).toBeCloseTo(surfaceHeight(corners, rotation, p.x, p.y), 9);
  });
});
