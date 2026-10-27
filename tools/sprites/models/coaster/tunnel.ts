import { box, material } from '../../mesh';
import type { Mesh } from '../../mesh';
import { ramp } from '../../palette';
import { TRACK_LOOKS } from './families';
import type { TrackArt } from './families';

const stone = material(ramp('stone'));
const dark = material(ramp('outline'), { fixedLevel: 0 });
/** Tile-unit height of one simulation height level. */
const LEVEL = 0.25;

/**
 * A stone tunnel mouth for the given track art, open toward +x and centred on the track where it
 * meets the hillside. The opening is wide enough for the ties and tall enough for a train.
 */
export function tunnelPortalMesh(art: TrackArt): Mesh {
  const look = TRACK_LOOKS[art];
  const half = look.tie.halfWidth + 0.07;
  const wall = 0.07;
  const height = 0.3;
  const reach = 0.06;
  const mesh: Mesh = [
    ...box([-reach, -half - wall, -0.2], [0.02, -half, height + wall], stone),
    ...box([-reach, half, -0.2], [0.02, half + wall, height + wall], stone),
    ...box([-reach, -half - wall, height], [0.02, half + wall, height + wall], stone),
    ...box([-reach, -half, -0.2], [-reach + 0.01, half, height], dark),
  ];
  return mesh.map((t) => ({
    material: t.material,
    v: t.v.map((p) => [p[0], p[1], p[2] / LEVEL]) as unknown as (typeof t)['v'],
  }));
}
