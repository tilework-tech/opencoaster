import { describe, expect, it } from 'vitest';
import { personMesh } from './models/people';
import { wallMesh } from './models/walls';
import { physicalToLevels } from './mesh';
import type { Mesh } from './mesh';
import { LEVEL_PX } from './raster';

/** On-screen height in pixels of a mesh's vertical extent: z maps linearly to screen y. */
function screenHeight(mesh: Mesh): number {
  const z = mesh.flatMap((triangle) => triangle.v.map((point) => point[2]));
  return (Math.max(...z) - Math.min(...z)) * LEVEL_PX;
}

const GUEST_HEIGHT = screenHeight(personMesh(0, 0, 0));

const STYLES = [
  { style: 'hedge', min: 0.45, max: 0.65 },
  { style: 'stone-fence', min: 0.65, max: 0.85 },
  { style: 'wooden-fence', min: 0.5, max: 0.7 },
] as const;

describe('wall proportions against the guest sprite', () => {
  for (const { style, min, max } of STYLES) {
    it(`keeps the ${style} between ${min} and ${max} guest heights on every edge`, () => {
      for (let edge = 0; edge < 4; edge++) {
        const ratio = screenHeight(physicalToLevels(wallMesh(style, edge, 0))) / GUEST_HEIGHT;
        expect(ratio, `${style} edge ${edge}`).toBeGreaterThanOrEqual(min);
        expect(ratio, `${style} edge ${edge}`).toBeLessThanOrEqual(max);
      }
    });
  }

  it('keeps the hedge at or below waist height of a guest', () => {
    expect(screenHeight(physicalToLevels(wallMesh('hedge', 0, 0))) / GUEST_HEIGHT).toBeLessThan(
      0.65,
    );
  });

  it('gives the hedge an irregular, clipped top', () => {
    const tops = new Set<number>();
    for (const triangle of wallMesh('hedge', 0, 0))
      for (const v of triangle.v) tops.add(Math.round(v[2] * 1000));
    expect(tops.size).toBeGreaterThan(8);
  });

  it('puts stone pillars above the wall courses', () => {
    const z = (mesh: Mesh) => Math.max(...mesh.flatMap((t) => t.v.map((p) => p[2])));
    expect(z(wallMesh('stone-fence', 0, 0))).toBeGreaterThan(0.25);
    const wallOnly = wallMesh('stone-fence', 0, 0).filter((t) =>
      t.v.every((p) => Math.abs(p[1]) < 0.4),
    );
    expect(z(wallOnly)).toBeLessThan(0.2);
  });

  it('follows slopes: raised corners lift the matching end', () => {
    const flat = wallMesh('hedge', 0, 0);
    const sloped = wallMesh('hedge', 0, 0b0110);
    const top = (m: Mesh) => Math.max(...m.flatMap((t) => t.v.map((p) => p[2])));
    expect(top(sloped)).toBeGreaterThan(top(flat) + 0.9);
  });
});
