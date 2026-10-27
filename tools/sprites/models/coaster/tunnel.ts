import { box, material, polygon, quad } from '../../mesh';
import type { Material, Mesh, Vec3 } from '../../mesh';
import { RAMP_LEVELS, ramp } from '../../palette';
import { TRACK_LOOKS } from './families';
import type { TrackArt } from './families';

/** How a portal meets the land; the same names as `TunnelVariant` in the simulation. */
export const TUNNEL_VARIANTS = ['face', 'slope', 'cut'] as const;
export type TunnelVariantName = (typeof TUNNEL_VARIANTS)[number];

const STONE = ramp('stone');
const GRASS = ramp('turf');
const DARK = ramp('outline')[0]!;
/** Tile-unit height of one simulation height level. */
const LEVEL = 0.25;
/** Height of a stone course and the width of its blocks, in tiles. */
const COURSE = 0.05;
const BLOCK = 0.1;
const ARCH_SEGMENTS = 10;
const FLOOR = -0.2;

/** Ashlar: staggered block courses with a darker mortar line, picked per pixel from model space. */
function ashlar(bias: number): Material {
  return material(STONE, {
    levelBias: bias,
    shader: (p, level) => {
      const course = Math.floor((p[2] - FLOOR) / COURSE);
      const along = p[0] + p[1] + (course & 1 ? BLOCK / 2 : 0);
      const v = (p[2] - FLOOR) / COURSE - course;
      const u = along / BLOCK - Math.floor(along / BLOCK);
      const joint = v < 0.16 || u < 0.1;
      const l = Math.max(0, Math.min(RAMP_LEVELS - 1, level - (joint ? 2 : 0)));
      return STONE[l]!;
    },
  });
}

/** Stone lit to a fixed level, for the inside of the tunnel that darkens with depth. */
const inner = (fixedLevel: number): Material => material(STONE, { fixedLevel });
const BLACK = material([DARK], { fixedLevel: 0 });
const voussoirA = material(STONE, { levelBias: 1 });
const voussoirB = material(STONE, { levelBias: 0 });
const keystone = material(STONE, { levelBias: 2 });
const coping = material(STONE, { levelBias: 1 });
const earth = material(GRASS, { fixedLevel: 2 });
const earthSide = material(GRASS, { fixedLevel: 1 });

interface Shape {
  /** Depth of the headwall behind the mouth plane. */
  depth: number;
  /** Stone beside the opening on each side. */
  pier: number;
  /** Height of the headwall top above the track. */
  top: number;
  /** Splayed wing walls: how far they reach out in front of the mouth (0 for none). */
  wing: number;
  /** Length of the grass embankment behind the headwall that blends it into the land. */
  mound: number;
  /** Height of the embankment crest where it ends, as a fraction of the headwall height. */
  crest: number;
}

const SHAPES: Record<TunnelVariantName, Shape> = {
  face: { depth: 0.2, pier: 0.1, top: 0.52, wing: 0, mound: 1.0, crest: 0.8 },
  slope: { depth: 0.16, pier: 0.09, top: 0.4, wing: 0.18, mound: 0.8, crest: 0.6 },
  cut: { depth: 0.2, pier: 0.09, top: 0.4, wing: 0.3, mound: 0.7, crest: 0.05 },
};

/**
 * A stone tunnel mouth for the given track art, open toward +x and centred on the track where it
 * meets the ground. The opening is wide enough for the ties and tall enough for a train; the arch
 * has a voussoir ring and a keystone, and the inside darkens with depth. The variants differ in
 * how the headwall meets the land: a flush wall for a cliff-like face, splayed wing walls for the
 * side of a hill, and wing walls with an embankment for track sinking into flat ground.
 */
export function tunnelPortalMesh(art: TrackArt, variant: TunnelVariantName = 'slope'): Mesh {
  const look = TRACK_LOOKS[art];
  const s = SHAPES[variant];
  const half = look.tie.halfWidth + 0.07;
  const wall = half + s.pier;
  const spring = 0.2;
  const rise = 0.1;
  const ring = 0.055;
  const face = ashlar(0);
  const side = ashlar(-1);
  const mesh: Mesh = [];

  const archY = (i: number): number => -half + (2 * half * i) / ARCH_SEGMENTS;
  const archZ = (i: number): number => {
    const u = (2 * i) / ARCH_SEGMENTS - 1;
    return spring + rise * (1 - u * u);
  };
  const at = (x: number, y: number, z: number): Vec3 => [x, y, z];

  // Headwall: piers either side of the opening, then the spandrel above the arch ring.
  mesh.push(
    ...box([-s.depth, -wall, FLOOR], [0, -half, s.top], {
      top: coping,
      left: face,
      right: face,
      back: side,
    }),
  );
  mesh.push(
    ...box([-s.depth, half, FLOOR], [0, wall, s.top], {
      top: coping,
      left: face,
      right: face,
      back: side,
    }),
  );
  for (let i = 0; i < ARCH_SEGMENTS; i++) {
    const y0 = archY(i);
    const y1 = archY(i + 1);
    const ringMat = i & 1 ? voussoirA : voussoirB;
    mesh.push(
      ...quad(
        [
          at(0.012, y0, archZ(i)),
          at(0.012, y1, archZ(i + 1)),
          at(0.012, y1, archZ(i + 1) + ring),
          at(0.012, y0, archZ(i) + ring),
        ],
        ringMat,
      ),
      ...quad(
        [
          at(0, y0, archZ(i) + ring),
          at(0, y1, archZ(i + 1) + ring),
          at(0, y1, s.top),
          at(0, y0, s.top),
        ],
        face,
      ),
      ...quad(
        [
          at(-s.depth, y0, archZ(i) + ring),
          at(0, y0, archZ(i) + ring),
          at(0, y0, s.top),
          at(-s.depth, y0, s.top),
        ],
        side,
      ),
    );
  }
  // Keystone, standing proud of the ring.
  mesh.push(
    ...box(
      [0, -0.032, spring + rise + 0.005],
      [0.03, 0.032, spring + rise + ring + 0.04],
      keystone,
    ),
  );
  // Coping along the headwall top.
  mesh.push(...box([-s.depth, -wall - 0.02, s.top], [0.02, wall + 0.02, s.top + 0.03], coping));
  // Base course that the headwall stands on, so it reads as set into the ground.
  mesh.push(...box([-s.depth, -wall - 0.015, FLOOR], [0.015, -half, 0.04], coping));
  mesh.push(...box([-s.depth, half, FLOOR], [0.015, wall + 0.015, 0.04], coping));

  // The inside: lit walls, soffit and floor that darken with depth, closed by a black back wall.
  const bands = [0.0, -0.05, -0.1, -s.depth];
  for (let b = 0; b < 3; b++) {
    const level = [3, 2, 1][b]!;
    const x0 = bands[b]!;
    const x1 = bands[b + 1]!;
    const m = inner(level);
    mesh.push(
      ...quad(
        [at(x0, -half, -0.02), at(x1, -half, -0.02), at(x1, -half, spring), at(x0, -half, spring)],
        m,
      ),
      ...quad(
        [at(x0, half, -0.02), at(x1, half, -0.02), at(x1, half, spring), at(x0, half, spring)],
        m,
      ),
      ...quad(
        [at(x0, -half, -0.02), at(x0, half, -0.02), at(x1, half, -0.02), at(x1, -half, -0.02)],
        inner(Math.max(0, level - 1)),
      ),
    );
    for (let i = 0; i < ARCH_SEGMENTS; i++)
      mesh.push(
        ...quad(
          [
            at(x0, archY(i), archZ(i)),
            at(x1, archY(i), archZ(i)),
            at(x1, archY(i + 1), archZ(i + 1)),
            at(x0, archY(i + 1), archZ(i + 1)),
          ],
          m,
        ),
      );
  }
  mesh.push(
    ...polygon(
      [
        at(-s.depth, -half, -0.02),
        at(-s.depth, half, -0.02),
        at(-s.depth, half, spring),
        ...Array.from({ length: ARCH_SEGMENTS - 1 }, (_, k) =>
          at(-s.depth, archY(ARCH_SEGMENTS - 1 - k), archZ(ARCH_SEGMENTS - 1 - k)),
        ),
        at(-s.depth, -half, spring),
      ],
      BLACK,
    ),
  );

  // Splayed wing walls that retain the land beside the mouth, stepping down as they reach out.
  if (s.wing > 0)
    for (const sign of [-1, 1]) {
      const y0 = sign * wall;
      const y1 = sign * (wall + s.wing * 0.9);
      const steps = 3;
      for (let k = 0; k < steps; k++) {
        const t0 = k / steps;
        const t1 = (k + 1) / steps;
        const top = s.top * (1 - t0) * 0.85 + 0.04;
        const lerp = (t: number): [number, number] => [s.wing * t, y0 + (y1 - y0) * t];
        const [xa, ya] = lerp(t0);
        const [xb, yb] = lerp(t1);
        mesh.push(
          ...quad([at(xa, ya, FLOOR), at(xb, yb, FLOOR), at(xb, yb, top), at(xa, ya, top)], face),
          ...box(
            [Math.min(xa, xb) - 0.01, Math.min(ya, yb) - 0.01, top],
            [Math.max(xa, xb) + 0.01, Math.max(ya, yb) + 0.01, top + 0.025],
            coping,
          ),
        );
      }
      // Rear face of the wing, so it is solid from behind.
      mesh.push(
        ...quad(
          [
            at(0, y0, FLOOR),
            at(s.wing, y1, FLOOR),
            at(s.wing, y1, 0.04),
            at(0, y0, s.top * 0.85 + 0.04),
          ],
          side,
        ),
      );
    }

  // Embankment: a grassed hump over the tunnel behind the headwall. Its crest tapers back toward
  // the ground and its flanks slope down to the ground either side, so the headwall reads as the
  // front of a mound set into the land; terrain that rises behind it simply covers the tail.
  {
    const back = -s.depth - s.mound;
    const w = wall + 0.01;
    const spread = 0.3;
    const crest = s.top * s.crest;
    const tail = w * 0.55;
    const base = FLOOR;
    const spreadY = w + spread;
    mesh.push(
      ...quad(
        [
          at(-s.depth, -w, s.top),
          at(-s.depth, w, s.top),
          at(back, tail, crest),
          at(back, -tail, crest),
        ],
        earth,
      ),
      ...quad(
        [
          at(-s.depth, w, s.top),
          at(-s.depth, spreadY, 0),
          at(back, spreadY * 0.7, 0),
          at(back, tail, crest),
        ],
        earthSide,
      ),
      ...quad(
        [
          at(-s.depth, -w, s.top),
          at(back, -tail, crest),
          at(back, -spreadY * 0.7, 0),
          at(-s.depth, -spreadY, 0),
        ],
        earth,
      ),
      ...polygon(
        [
          at(back, tail, crest),
          at(back, spreadY * 0.7, 0),
          at(back, spreadY * 0.7, base),
          at(back, -spreadY * 0.7, base),
          at(back, -spreadY * 0.7, 0),
          at(back, -tail, crest),
        ],
        earthSide,
      ),
      ...polygon(
        [
          at(-s.depth, w, s.top),
          at(-s.depth, spreadY, 0),
          at(-s.depth, spreadY, base),
          at(-s.depth, w, base),
        ],
        earthSide,
      ),
      ...polygon(
        [
          at(-s.depth, -w, s.top),
          at(-s.depth, -w, base),
          at(-s.depth, -spreadY, base),
          at(-s.depth, -spreadY, 0),
        ],
        earthSide,
      ),
    );
  }

  return mesh.map((t) => ({
    material: t.material,
    v: t.v.map((p) => [p[0], p[1], p[2] / LEVEL]) as unknown as (typeof t)['v'],
  }));
}
