import { beam, box, cylinder, material } from '../../mesh';
import type { Mesh } from '../../mesh';
import { ramp } from '../../palette';
import { SUPPORT_LOOKS } from './families';
import type { CoasterFamily } from './families';

const stone = material(ramp('stone'));
/** Tile-unit height of one simulation height level. */
const LEVEL = 0.25;

/**
 * One piece of support column `levels` tall (heights in simulation levels, footprint in tiles),
 * standing on z = 0. The track runs along +x, so braced bents span y.
 */
export function supportSegmentMesh(family: CoasterFamily, levels: number): Mesh {
  const support = SUPPORT_LOOKS[family];
  const height = levels * LEVEL;
  const out: Mesh = [];
  if (support.kind === 'bent') {
    for (const y of [-support.half, support.half])
      out.push(...beam([0, y, 0], [0, y, height], support.size, support.mat));
    out.push(
      ...beam([0, -support.half, 0], [0, support.half, height], 0.03, support.brace, 0.03),
      ...beam([0, support.half, 0], [0, -support.half, height], 0.03, support.brace, 0.03),
    );
    if (levels >= 1)
      out.push(
        ...beam([0, -support.half, height], [0, support.half, height], 0.035, support.mat, 0.045),
      );
  } else {
    out.push(...cylinder(0, 0, 0, height, support.size / 2, support.size / 2, 8, support.mat));
    out.push(...cylinder(0, 0, 0, Math.min(0.02, height), support.size * 0.7, support.size * 0.7, 8, support.brace));
  }
  return out.map((t) => ({
    material: t.material,
    v: t.v.map((p) => [p[0], p[1], p[2] / LEVEL]) as unknown as (typeof t)['v'],
  }));
}

/** Footing the column stands on. */
export function supportBaseMesh(family: CoasterFamily): Mesh {
  const support = SUPPORT_LOOKS[family];
  const half = support.kind === 'bent' ? support.half + 0.06 : 0.09;
  return box([-0.07, -half, -0.04], [0.07, half, 0.04], stone);
}
