import { beam, box, material, PHYSICAL_Z, translateMesh } from '../mesh';
import type { Material, Mesh, Vec3 } from '../mesh';
import { hash2 } from '../noise';
import { ramp } from '../palette';

const WOOD = material(ramp('wood'));
const TIMBER = material(ramp('timber'));
const LEAF = ramp('green');
const SUNLIT_LEAF = ramp('grass');
const BLOCKS = ramp('stone');
const MORTAR = ramp('asphalt');

/** Physical heights (tile units); a guest stands about 0.37 tall, so a hedge reaches the waist. */
export const HEDGE_HEIGHT = 0.24;
export const STONE_WALL_HEIGHT = 0.17;
export const STONE_PILLAR_HEIGHT = 0.28;
export const WOODEN_FENCE_HEIGHT = 0.23;
/** The park boundary: a low rail-and-post fence along the edge of owned land. */
export const PARK_FENCE_HEIGHT = 0.3;

const HEDGE_SEGMENTS = 16;
const STONE_SEGMENTS = 8;
const FOLIAGE_CELLS = 22;
const FOLIAGE_Z_CELLS = 36;

function edgeEnds(
  edge: number,
  slopeMask: number,
): [[number, number, number], [number, number, number]] {
  const heights = [0, 1, 2, 3].map((corner) => (slopeMask >> corner) & 1);
  switch (edge & 3) {
    case 0:
      return [
        [0.46, -0.5, heights[1]!],
        [0.46, 0.5, heights[2]!],
      ];
    case 1:
      return [
        [-0.5, 0.46, heights[3]!],
        [0.5, 0.46, heights[2]!],
      ];
    case 2:
      return [
        [-0.46, -0.5, heights[0]!],
        [-0.46, 0.5, heights[3]!],
      ];
    default:
      return [
        [-0.5, -0.46, heights[0]!],
        [0.5, -0.46, heights[1]!],
      ];
  }
}

type Point = [number, number, number];

function lerp(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Clipped-foliage pixels: clumped light and dark leaves, hashed on a grid that repeats per tile. */
function foliage(seed: number): Material {
  return material(LEAF, {
    levelBias: -1,
    shader: (p: Vec3, level: number) => {
      const cx = Math.floor(p[0] * FOLIAGE_CELLS);
      const cy = Math.floor(p[1] * FOLIAGE_CELLS);
      const cz = Math.floor(p[2] * FOLIAGE_Z_CELLS);
      const r = hash2(cx * 31 + cz, cy * 17 - cz, seed);
      const clump = hash2(cx >> 1, (cy >> 1) + (cz >> 1) * 7, seed + 5);
      const shifted = level + (r < 0.2 ? -1 : r > 0.8 ? 1 : 0) + (clump > 0.7 ? 1 : 0);
      const lit = Math.max(0, Math.min(4, shifted));
      if (lit >= 3 && r > 0.55) return SUNLIT_LEAF[Math.min(4, lit)]!;
      return LEAF[lit]!;
    },
  });
}

/** Dressed stone: staggered courses of blocks separated by dark mortar joints. */
function blockwork(base: number, courseHeight: number, seed: number): Material {
  const courseLevels = courseHeight * PHYSICAL_Z;
  return material(BLOCKS, {
    shader: (p: Vec3, level: number) => {
      const course = Math.floor((p[2] - base) / courseLevels + 1e-6);
      const along = (p[0] + p[1]) * 4 + (course & 1 ? 0.5 : 0);
      const block = Math.floor(along);
      const inCourse = (p[2] - base) / courseLevels - course;
      if (inCourse < 0.1 || along - block < 0.07) return MORTAR[Math.min(2, level)]!;
      const r = hash2(block, course, seed);
      return BLOCKS[Math.max(0, Math.min(4, level + (r < 0.25 ? -1 : r > 0.8 ? 1 : 0)))]!;
    },
  });
}

/** Overhang past the run's ends, as a fraction of the tile, so perpendicular hedges meet at corners. */
const END_OVERHANG = 0.08;

/** Axis-aligned box centred on the edge line covering the stretch p0..p1, `half` wide across it. */
function segmentBox(
  edge: number,
  p0: Point,
  p1: Point,
  half: number,
  height: number,
  mat: Material,
): Mesh {
  const along = edge % 2 === 0 ? 1 : 0; // edges 0 and 2 run along y
  const min: Point = [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.min(p0[2], p1[2])];
  const max: Point = [Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1]), Math.max(p0[2], p1[2])];
  min[1 - along] -= half;
  max[1 - along] += half;
  return box(min, [max[0], max[1], min[2] + height], mat);
}

function hedgeMesh(edge: number, a: Point, b: Point): Mesh {
  const mesh: Mesh = [];
  const body = foliage(1);
  const crown = foliage(2);
  const lastSeg = HEDGE_SEGMENTS - 1;
  for (let step = 0; step < HEDGE_SEGMENTS; step++) {
    const p0 = lerp(a, b, step / HEDGE_SEGMENTS);
    const p1 = lerp(a, b, (step + 1) / HEDGE_SEGMENTS);
    // Heights depend only on position within the tile and repeat every tile, so runs join exactly.
    const s = (step + 0.5) / HEDGE_SEGMENTS;
    const wobble =
      0.011 * Math.sin(2 * Math.PI * 3 * s + 0.6) +
      0.007 * Math.sin(2 * Math.PI * 5 * s + 2.1) +
      (hash2(step, 11, 3) - 0.5) * 0.012;
    const q0 = step === 0 ? lerp(a, b, -END_OVERHANG) : p0;
    const q1 = step === lastSeg ? lerp(a, b, 1 + END_OVERHANG) : p1;
    mesh.push(...segmentBox(edge, q0, q1, 0.105, HEDGE_HEIGHT * 0.62, body));
    mesh.push(...segmentBox(edge, q0, q1, 0.088, HEDGE_HEIGHT * 0.9 + wobble * 1.2, crown));
  }
  return mesh;
}

function stoneMesh(edge: number, a: Point, b: Point): Mesh {
  const mesh: Mesh = [];
  for (let step = 0; step < STONE_SEGMENTS; step++) {
    const p0 = lerp(a, b, step / STONE_SEGMENTS);
    const p1 = lerp(a, b, (step + 1) / STONE_SEGMENTS);
    const base = Math.min(p0[2], p1[2]);
    mesh.push(
      ...segmentBox(
        edge,
        p0,
        p1,
        0.04,
        STONE_WALL_HEIGHT - 0.02,
        blockwork(base * PHYSICAL_Z, 0.043, 7),
      ),
      ...translateMesh(
        segmentBox(edge, p0, p1, 0.052, 0.02, material(BLOCKS, { levelBias: 1 })),
        0,
        0,
        STONE_WALL_HEIGHT - 0.02,
      ),
    );
  }
  for (const end of [a, b]) {
    const [x, y, z] = end;
    const shaft = 0.058;
    mesh.push(
      ...box(
        [x - shaft, y - shaft, z],
        [x + shaft, y + shaft, z + STONE_PILLAR_HEIGHT - 0.035],
        blockwork(z * PHYSICAL_Z, 0.043, 9),
      ),
      ...box(
        [x - 0.076, y - 0.076, z + STONE_PILLAR_HEIGHT - 0.035],
        [x + 0.076, y + 0.076, z + STONE_PILLAR_HEIGHT - 0.012],
        material(BLOCKS, { levelBias: 1 }),
      ),
      ...box(
        [x - 0.048, y - 0.048, z + STONE_PILLAR_HEIGHT - 0.012],
        [x + 0.048, y + 0.048, z + STONE_PILLAR_HEIGHT],
        material(BLOCKS, { levelBias: 0 }),
      ),
    );
  }
  return mesh;
}

function woodenMesh(a: Point, b: Point): Mesh {
  const [ax, ay, az] = a;
  const [bx, by, bz] = b;
  const post = (x: number, y: number, z: number): Mesh => [
    ...box([x - 0.03, y - 0.03, z], [x + 0.03, y + 0.03, z + WOODEN_FENCE_HEIGHT], WOOD),
    ...box(
      [x - 0.036, y - 0.036, z + WOODEN_FENCE_HEIGHT],
      [x + 0.036, y + 0.036, z + WOODEN_FENCE_HEIGHT + 0.015],
      TIMBER,
    ),
  ];
  return [
    ...post(ax, ay, az),
    ...post((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2),
    ...post(bx, by, bz),
    ...beam([ax, ay, az + 0.08], [bx, by, bz + 0.08], 0.03, TIMBER),
    ...beam([ax, ay, az + 0.17], [bx, by, bz + 0.17], 0.03, TIMBER),
  ];
}

function parkFenceMesh(a: Point, b: Point): Mesh {
  const [ax, ay, az] = a;
  const [bx, by, bz] = b;
  const post = (x: number, y: number, z: number): Mesh =>
    box([x - 0.025, y - 0.025, z], [x + 0.025, y + 0.025, z + PARK_FENCE_HEIGHT], TIMBER);
  return [
    ...post(ax, ay, az),
    ...post(bx, by, bz),
    ...beam([ax, ay, az + 0.07], [bx, by, bz + 0.07], 0.02, TIMBER),
    ...beam(
      [ax, ay, az + PARK_FENCE_HEIGHT - 0.02],
      [bx, by, bz + PARK_FENCE_HEIGHT - 0.02],
      0.025,
      WOOD,
    ),
  ];
}

export type WallStyle = 'hedge' | 'wooden-fence' | 'stone-fence' | 'park-fence';

export function wallMesh(style: WallStyle, edge: number, slopeMask: number): Mesh {
  const [a, b] = edgeEnds(edge, slopeMask);
  if (style === 'hedge') return hedgeMesh(edge, a, b);
  if (style === 'stone-fence') return stoneMesh(edge, a, b);
  if (style === 'park-fence') return parkFenceMesh(a, b);
  return woodenMesh(a, b);
}
