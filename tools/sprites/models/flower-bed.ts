import { box, material } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';

const STONE = material(ramp('stone'));
const SOIL = material(ramp('dirt'));
const LEAVES = material(ramp('green'), { fixedLevel: 3 });
const FLOWER_RAMPS = ['pink', 'orange', 'blue', 'purple'] as const;
const ACCENT_RAMPS = ['yellow', 'white', 'pink', 'orange'] as const;

/** A raised stone-edged soil bed with a dense, varied planting. */
export function flowerBedMesh(variant: number): Mesh {
  const flowers = material(ramp(FLOWER_RAMPS[((variant % 4) + 4) % 4]!), { fixedLevel: 2 });
  const accents = material(ramp(ACCENT_RAMPS[((variant % 4) + 4) % 4]!), { fixedLevel: 2 });
  const out: Mesh = [
    ...box([-0.43, -0.26, 0], [0.43, 0.26, 0.13], {
      top: SOIL,
      left: STONE,
      right: STONE,
    }),
    ...box([-0.43, -0.26, 0.13], [0.43, -0.18, 0.21], STONE),
    ...box([-0.43, 0.18, 0.13], [0.43, 0.26, 0.21], STONE),
    ...box([-0.43, -0.18, 0.13], [-0.35, 0.18, 0.21], STONE),
    ...box([0.35, -0.18, 0.13], [0.43, 0.18, 0.21], STONE),
  ];

  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 6; column++) {
      const x = -0.28 + column * 0.112 + (row % 2) * 0.028;
      const y = -0.105 + row * 0.105;
      const flower = (row * 7 + column + variant) % 5 === 0 ? accents : flowers;
      out.push(
        ...box([x - 0.025, y - 0.022, 0.14], [x + 0.025, y + 0.022, 0.185], LEAVES),
        ...box([x - 0.018, y - 0.017, 0.185], [x + 0.018, y + 0.017, 0.22], flower),
      );
    }
  }

  return out;
}
