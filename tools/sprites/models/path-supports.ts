import { box, material } from '../mesh';
import type { Material, Mesh } from '../mesh';
import { ramp } from '../palette';
import type { PathStyle } from './paths';

/** Tile-unit height of one simulation height level. */
const LEVEL = 0.25;
/** Distance of each square post from the tile centre; the posts stand under the slab's corners. */
const POST_OFFSET = 0.36;
const POST = 0.09;
const TIE = 0.05;
const FOOTING = 0.15;
const FOOTING_HEIGHT = 0.05;

const POST_RAMPS: Record<PathStyle, string> = {
  tarmac: 'asphalt',
  'crazy-paving': 'paving',
  dirt: 'dirt',
  queue: 'brick',
};

const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/** Heights are authored in tile units and rendered in simulation levels. */
function inLevels(mesh: Mesh): Mesh {
  return mesh.map((t) => ({
    material: t.material,
    v: t.v.map((p) => [p[0], p[1], p[2] / LEVEL]) as unknown as (typeof t)['v'],
  }));
}

function posts(height: number, mat: Material): Mesh {
  return CORNERS.flatMap(([sx, sy]) =>
    box(
      [sx * POST_OFFSET - POST / 2, sy * POST_OFFSET - POST / 2, 0],
      [sx * POST_OFFSET + POST / 2, sy * POST_OFFSET + POST / 2, height],
      mat,
    ),
  );
}

/** Square ties joining the four posts at height `z`, running along both tile axes. */
function ties(z: number, mat: Material): Mesh {
  const half = POST_OFFSET;
  return [
    ...box([-half, -half - TIE / 2, z], [half, -half + TIE / 2, z + TIE], mat),
    ...box([-half, half - TIE / 2, z], [half, half + TIE / 2, z + TIE], mat),
    ...box([-half - TIE / 2, -half, z], [-half + TIE / 2, half, z + TIE], mat),
    ...box([half - TIE / 2, -half, z], [half + TIE / 2, half, z + TIE], mat),
  ];
}

/** One level of posts with a tie at mid-height. */
export function pathSupportColumnMesh(style: PathStyle): Mesh {
  const mat = material(ramp(POST_RAMPS[style]));
  return inLevels([...posts(LEVEL, mat), ...ties(LEVEL / 2 - TIE / 2, mat)]);
}

/** Topmost level: posts joined by a frame that carries the slab. */
export function pathSupportCapMesh(style: PathStyle): Mesh {
  const mat = material(ramp(POST_RAMPS[style]));
  return inLevels([...posts(LEVEL, mat), ...ties(LEVEL - TIE, mat)]);
}

/** Stone footings the posts stand on. */
export function pathSupportBaseMesh(): Mesh {
  const mat = material(ramp('stone'));
  return inLevels(
    CORNERS.flatMap(([sx, sy]) =>
      box(
        [sx * POST_OFFSET - FOOTING / 2, sy * POST_OFFSET - FOOTING / 2, 0],
        [sx * POST_OFFSET + FOOTING / 2, sy * POST_OFFSET + FOOTING / 2, FOOTING_HEIGHT],
        mat,
      ),
    ),
  );
}
