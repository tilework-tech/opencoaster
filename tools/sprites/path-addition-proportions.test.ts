import { describe, expect, it } from 'vitest';
import { personMesh } from './models/people';
import {
  benchMesh,
  binMesh,
  brokenBenchMesh,
  brokenBinMesh,
  brokenLampMesh,
  lampMesh,
} from './models/path-additions';
import { physicalToLevels, rotateMesh } from './mesh';
import type { Mesh } from './mesh';
import { LEVEL_PX, TRANSPARENT, renderMesh } from './raster';

/** On-screen height in pixels of a mesh's vertical extent: z maps linearly to screen y. */
function screenHeight(mesh: Mesh): number {
  const z = mesh.flatMap((triangle) => triangle.v.map((point) => point[2]));
  return (Math.max(...z) - Math.min(...z)) * LEVEL_PX;
}

const GUEST_HEIGHT = screenHeight(personMesh(0, 0, 0));

const PROPS: readonly {
  name: string;
  intact: () => Mesh;
  vandalised: () => Mesh;
  min: number;
  max: number;
}[] = [
  { name: 'bench', intact: benchMesh, vandalised: brokenBenchMesh, min: 0.5, max: 0.67 },
  { name: 'bin', intact: binMesh, vandalised: brokenBinMesh, min: 0.4, max: 0.5 },
  { name: 'lamp', intact: lampMesh, vandalised: brokenLampMesh, min: 1.3, max: 1.5 },
];

function opaqueSize(mesh: Mesh): { width: number; height: number } {
  const sprite = renderMesh(mesh);
  let minX = Infinity;
  let maxX = -1;
  for (let y = 0; y < sprite.height; y++)
    for (let x = 0; x < sprite.width; x++)
      if (sprite.pixels[y * sprite.width + x] !== TRANSPARENT) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
  return { width: maxX - minX + 1, height: sprite.height };
}

describe('path addition proportions against the guest sprite', () => {
  it('measures a non-empty guest', () => {
    expect(GUEST_HEIGHT).toBeGreaterThan(10);
  });

  for (const prop of PROPS) {
    it(`keeps the ${prop.name} between ${prop.min} and ${prop.max} guest heights`, () => {
      const ratio = screenHeight(physicalToLevels(prop.intact())) / GUEST_HEIGHT;
      expect(ratio).toBeGreaterThanOrEqual(prop.min);
      expect(ratio).toBeLessThanOrEqual(prop.max);
    });

    it(`gives the vandalised ${prop.name} the intact height`, () => {
      const intact = screenHeight(physicalToLevels(prop.intact()));
      const vandalised = screenHeight(physicalToLevels(prop.vandalised()));
      expect(Math.abs(vandalised - intact) / GUEST_HEIGHT).toBeLessThan(0.03);
    });
  }

  it('keeps the bench within about half a tile edge and the bin and lamp narrow in every view', () => {
    const tileEdgePx = 32;
    for (let view = 0; view < 4; view++) {
      const bench = opaqueSize(rotateMesh(physicalToLevels(benchMesh()), view));
      expect(bench.width).toBeLessThanOrEqual(Math.round((0.5 + 0.15) * tileEdgePx) + 2);
      const bin = opaqueSize(rotateMesh(physicalToLevels(binMesh()), view));
      expect(bin.width).toBeLessThanOrEqual(10);
      const lamp = opaqueSize(rotateMesh(physicalToLevels(lampMesh()), view));
      expect(lamp.width).toBeLessThanOrEqual(8);
    }
  });
});
