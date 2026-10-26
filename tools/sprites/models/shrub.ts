import { box, material } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';

const LEAF_DARK = material(ramp('green'));
const LEAF_LIGHT = material(ramp('grass'));

const VARIANTS = [
  [
    [-0.28, -0.18, 0.28, 0.2],
    [-0.12, 0.05, 0.27, 0.3],
    [0.08, -0.14, 0.28, 0.22],
    [0.23, 0.03, 0.2, 0.27],
  ],
  [
    [-0.25, -0.09, 0.22, 0.24],
    [-0.05, -0.17, 0.34, 0.25],
    [0.16, -0.04, 0.23, 0.29],
  ],
  [
    [-0.3, -0.04, 0.21, 0.23],
    [-0.13, -0.14, 0.27, 0.31],
    [0.08, -0.09, 0.3, 0.24],
    [0.26, 0.06, 0.18, 0.25],
  ],
  [
    [-0.24, -0.16, 0.25, 0.27],
    [-0.05, 0.04, 0.29, 0.22],
    [0.17, -0.12, 0.27, 0.3],
  ],
] as const;

/** Low, broad leaf clusters in physical tile units. */
export function shrubMesh(variant: number): Mesh {
  const clusters = VARIANTS[((variant % VARIANTS.length) + VARIANTS.length) % VARIANTS.length]!;
  return [
    ...box([-0.24, -0.17, 0.02], [0.24, 0.17, 0.18], LEAF_DARK),
    ...clusters.flatMap(([x, y, width, height], index) =>
      box(
        [x, y, 0.02],
        [x + width, y + width * 0.72, height],
        index % 2 === 0 ? LEAF_DARK : LEAF_LIGHT,
      ),
    ),
  ];
}
