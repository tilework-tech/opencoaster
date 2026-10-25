import { material, quad } from '../mesh';
import type { Mesh, Vec3 } from '../mesh';
import { ramp, waterColor } from '../palette';
import { hash2 } from '../noise';

export const WATER_FRAMES = 8;
export const SHORE_FRAMES = 4;

/** Ripple slot (0-7) of a water pixel; the shimmer is this slot advancing through the palette cycle. */
export function waterSlot(x: number, y: number): number {
  const i = Math.floor((x + 0.5) * 32);
  const j = Math.floor((y + 0.5) * 32);
  const wave = (i + 2 * j) & 7;
  const jitter = Math.floor(hash2(i >> 1, j >> 1, 21) * 3);
  return (wave + jitter) & 7;
}

/** One flat tile of water; frames differ only by the palette-cycle offset. */
export function waterMesh(frame: number): Mesh {
  const surface = material(ramp('foam'), {
    shader: (p: Vec3) => waterColor(waterSlot(p[0], p[1]), frame),
  });
  return quad(
    [
      [-0.5, -0.5, 0],
      [0.5, -0.5, 0],
      [0.5, 0.5, 0],
      [-0.5, 0.5, 0],
    ],
    surface,
  );
}

const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

/** Waterline segments of a terrain tile whose raised corners (bit n = corner n) are land. */
function contour(mask: number): Array<[[number, number], [number, number]]> {
  const edgeMid = (a: number): [number, number] => {
    const b = (a + 1) % 4;
    return [(CORNERS[a][0] + CORNERS[b][0]) / 2, (CORNERS[a][1] + CORNERS[b][1]) / 2];
  };
  const raised = (n: number): boolean => (mask & (1 << n)) !== 0;
  const crossings = [0, 1, 2, 3].filter((e) => raised(e) !== raised((e + 1) % 4));
  if (crossings.length === 2) return [[edgeMid(crossings[0]), edgeMid(crossings[1])]];
  if (crossings.length === 4)
    return [
      [edgeMid(3), edgeMid(0)],
      [edgeMid(1), edgeMid(2)],
    ];
  return [];
}

/** Foam line along the waterline, shimmering by frame. Empty (no triangles) for flat tiles. */
export function shoreMesh(mask: number, frame: number): Mesh {
  const foam = ramp('foam');
  const mat = material(foam, {
    shader: (p: Vec3) => {
      const t = Math.floor((p[0] * 3 + p[1] * 5 + 4) * 6);
      return foam[2 + (((t + frame) & 3) === 0 ? 2 : (t + frame) & 1)];
    },
  });
  const out: Mesh = [];
  const half = 0.045;
  for (const [a, b] of contour(mask)) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;
    out.push(
      ...quad(
        [
          [a[0] + nx, a[1] + ny, 0.01],
          [b[0] + nx, b[1] + ny, 0.01],
          [b[0] - nx, b[1] - ny, 0.01],
          [a[0] - nx, a[1] - ny, 0.01],
        ],
        mat,
      ),
    );
  }
  return out;
}
