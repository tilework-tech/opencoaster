import { terrainMeshTriangles } from '../../../src/render/terrain-geometry';
import { box, material, PHYSICAL_Z, quad } from '../mesh';
import type { Mesh, Vec3 } from '../mesh';
import { ramp } from '../palette';

const STONE = material(ramp('stone'));
const SOIL = material(ramp('dirt'));
const LEAVES = material(ramp('green'), { fixedLevel: 3 });
const FLOWER_RAMPS = ['pink', 'orange', 'blue', 'purple'] as const;
const ACCENT_RAMPS = ['yellow', 'white', 'pink', 'orange'] as const;
const CORNERS: readonly Vec3[] = [
  [-0.5, -0.5, 0],
  [0.5, -0.5, 0],
  [0.5, 0.5, 0],
  [-0.5, 0.5, 0],
];
const EDGE_WIDTH = 0.015;
const EDGE_HEIGHT = 0.01;
const FLOWER_HEIGHT = 0.18;
/**
 * The bed rests on the terrain rather than in it: one screen pixel up, like a path surface, so the
 * soil is always nearer the camera than the ground under it.
 */
const SOIL_LIFT = 1 / 16 / PHYSICAL_Z;

function surfaceHeight(x: number, y: number, slopeMask: number, view: number): number {
  const pointX = x + 0.5;
  const pointY = y + 0.5;
  const heights = CORNERS.map((_, corner) => (slopeMask >> corner) & 1);
  for (const triangle of terrainMeshTriangles(view)) {
    const [a, b, c] = triangle.map((index) => CORNERS[index]!);
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    const wa =
      ((b[1] - c[1]) * (pointX - (c[0] + 0.5)) + (c[0] - b[0]) * (pointY - (c[1] + 0.5))) /
      denominator;
    const wb =
      ((c[1] - a[1]) * (pointX - (c[0] + 0.5)) + (a[0] - c[0]) * (pointY - (c[1] + 0.5))) /
      denominator;
    const wc = 1 - wa - wb;
    if (wa >= -1e-7 && wb >= -1e-7 && wc >= -1e-7)
      return wa * heights[triangle[0]]! + wb * heights[triangle[1]]! + wc * heights[triangle[2]]!;
  }
  throw new Error(`Tile coordinate (${x}, ${y}) is outside the flowerbed surface`);
}

/** A flowerbed surface matching the terrain tile, with a low edge and compact flowers. */
export function flowerBedMesh(variant: number, slopeMask = 0, view = 0): Mesh {
  const colour = material(ramp(FLOWER_RAMPS[((variant % 4) + 4) % 4]!), { fixedLevel: 2 });
  const accents = material(ramp(ACCENT_RAMPS[((variant % 4) + 4) % 4]!), { fixedLevel: 2 });
  const triangles = terrainMeshTriangles(view);
  const diagonal = triangles[0].filter((corner) => triangles[1].includes(corner));
  const centerHeight = diagonal.reduce((sum, corner) => sum + ((slopeMask >> corner) & 1), 0) / 2;
  const zAt = (x: number, y: number): number =>
    (surfaceHeight(x, y, slopeMask, view) - centerHeight) / PHYSICAL_Z + SOIL_LIFT;
  const point = (x: number, y: number, z = 0): Vec3 => [x, y, z + zAt(x, y)];
  const soil: Mesh = triangles.map((corners) => ({
    v: corners.map((corner) => {
      const [x, y] = CORNERS[corner]!;
      return point(x, y);
    }) as unknown as Mesh[number]['v'],
    material: SOIL,
  }));
  const bed: Mesh = [...soil];

  const addEdge = (
    start: readonly [number, number],
    end: readonly [number, number],
    inset: readonly [number, number],
  ): void => {
    const [sx, sy] = start;
    const [ex, ey] = end;
    const [ix, iy] = inset;
    const outsideStart = point(sx, sy);
    const outsideEnd = point(ex, ey);
    const insideEnd = point(ex + ix, ey + iy);
    const insideStart = point(sx + ix, sy + iy);
    const top = [outsideStart, outsideEnd, insideEnd, insideStart].map(
      ([x, y, z]) => [x, y, z + EDGE_HEIGHT] as Vec3,
    );
    bed.push(...quad(top as [Vec3, Vec3, Vec3, Vec3], STONE));
  };
  addEdge([-0.5, -0.5], [0.5, -0.5], [0, EDGE_WIDTH]);
  addEdge([0.5, -0.5], [0.5, 0.5], [-EDGE_WIDTH, 0]);
  addEdge([0.5, 0.5], [-0.5, 0.5], [0, -EDGE_WIDTH]);
  addEdge([-0.5, 0.5], [-0.5, -0.5], [EDGE_WIDTH, 0]);

  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 6; column++) {
      const jitter = ((row * 11 + column * 7 + variant * 3) % 5) * 0.006;
      const x = -0.34 + column * 0.136 + (row % 2) * 0.035 + jitter;
      const y = -0.34 + row * 0.17 + ((row * 3 + column + variant) % 3) * 0.009;
      const z = zAt(x, y);
      const flower = (row * 7 + column + variant) % 5 === 0 ? accents : colour;
      bed.push(
        ...box([x - 0.008, y - 0.008, z], [x + 0.008, y + 0.008, z + 0.1], LEAVES),
        ...box([x - 0.025, y - 0.023, z + 0.1], [x + 0.025, y + 0.023, z + FLOWER_HEIGHT], flower),
      );
    }
  }

  return bed;
}
