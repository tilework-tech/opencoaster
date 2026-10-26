import { box, mapMesh, material, PHYSICAL_Z } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';

const STONE = material(ramp('stone'));
const SOIL = material(ramp('dirt'));
const LEAVES = material(ramp('green'), { fixedLevel: 3 });
const FLOWER_RAMPS = ['pink', 'orange', 'blue', 'purple'] as const;
const ACCENT_RAMPS = ['yellow', 'white', 'pink', 'orange'] as const;

/** A raised stone-edged soil bed filled with compact, varied flowering clumps. */
export function flowerBedMesh(variant: number, slopeMask = 0): Mesh {
  const flowers = material(ramp(FLOWER_RAMPS[((variant % 4) + 4) % 4]!), { fixedLevel: 2 });
  const accents = material(ramp(ACCENT_RAMPS[((variant % 4) + 4) % 4]!), { fixedLevel: 2 });
  const bed: Mesh = [
    ...box([-0.46, -0.46, 0], [0.46, 0.46, 0.13], {
      top: SOIL,
      left: STONE,
      right: STONE,
    }),
    ...box([-0.46, -0.46, 0.13], [0.46, -0.39, 0.21], STONE),
    ...box([-0.46, 0.39, 0.13], [0.46, 0.46, 0.21], STONE),
    ...box([-0.46, -0.39, 0.13], [-0.39, 0.39, 0.21], STONE),
    ...box([0.39, -0.39, 0.13], [0.46, 0.39, 0.21], STONE),
  ];

  const plants: Mesh = [];
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 7; column++) {
      const jitter = ((row * 11 + column * 7 + variant * 3) % 5) * 0.006;
      const x = -0.32 + column * 0.106 + (row % 2) * 0.026 + jitter;
      const y = -0.31 + row * 0.155 + ((row * 3 + column + variant) % 3) * 0.009;
      const flower = (row * 7 + column + variant) % 5 === 0 ? accents : flowers;
      plants.push(
        ...box([x - 0.034, y - 0.033, 0.14], [x + 0.034, y + 0.033, 0.22], LEAVES),
        ...box([x - 0.026, y - 0.025, 0.22], [x + 0.026, y + 0.025, 0.31], flower),
      );
    }
  }

  const heights = [0, 1, 2, 3].map((corner) => (slopeMask >> corner) & 1);
  const slopeX = (heights[1]! + heights[2]! - heights[0]! - heights[3]!) / 2;
  const slopeY = (heights[2]! + heights[3]! - heights[0]! - heights[1]!) / 2;
  const groundOffset = (x: number, y: number): number =>
    (slopeX * x + slopeY * y) / PHYSICAL_Z;
  return [
    ...mapMesh(bed, ([x, y, z]) => [x, y, z + groundOffset(x, y)]),
    ...mapMesh(plants, ([x, y, z]) => [x, y, z + groundOffset(x, y)]),
  ];
}
