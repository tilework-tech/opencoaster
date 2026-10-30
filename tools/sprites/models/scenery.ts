import {
  PHYSICAL_Z,
  beam,
  box,
  cylinder,
  mapMesh,
  material,
  polygon,
  quad,
  rotateX,
  rotateY,
  translateMesh,
} from '../mesh';
import type { Mesh, Vec3 } from '../mesh';
import { ramp } from '../palette';

/**
 * Decorative scenery in physical tile units, authored on tile (0, 0) with the ground at z = 0.
 * A guest stands 0.373 tall, so a statue of 0.9 is about two and a half guests high. Directional
 * models face +x: that is the side a sign is read from, a statue raises its arm towards, and so on.
 */

const STONE = material(ramp('stone'));
const MARBLE = material(ramp('white'));
const SOIL = material(ramp('dirt'));
const LEAF = material(ramp('green'));
const GRASS = material(ramp('grass'));
const WOOD = material(ramp('wood'));
const TIMBER = material(ramp('timber'));
const WATER = material(ramp('blue'), { fixedLevel: 3 });
const FOAM = material(ramp('foam'));
const BRASS = material(ramp('yellow'));
const STEEL = material(ramp('steel'));
const BRICK = material(ramp('brick'));

const COLOUR = (name: string): ReturnType<typeof material> => material(ramp(name));

/** Deterministic pseudo-random sequence so a model is the same on every generation. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lumpy low-poly rock: faceted rings that narrow to a flat-bottomed dome. */
function rock(
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  height: number,
  seed: number,
  mat: ReturnType<typeof material> = STONE,
): Mesh {
  const next = sequence(seed);
  const segments = 7;
  const levels: ReadonlyArray<readonly [number, number]> = [
    [0, 0.95],
    [0.4, 1],
    [0.78, 0.66],
  ];
  const rings = levels.map(([z, scale], level) =>
    Array.from({ length: segments }, (_, i): Vec3 => {
      const angle = ((i + level * 0.4) / segments) * Math.PI * 2;
      const jitter = 0.82 + next() * 0.3;
      return [
        cx + Math.cos(angle) * radiusX * scale * jitter,
        cy + Math.sin(angle) * radiusY * scale * jitter,
        height * z * (level === 0 ? 1 : 0.9 + next() * 0.2),
      ];
    }),
  );
  const apex: Vec3 = [
    cx + (next() - 0.5) * radiusX * 0.2,
    cy + (next() - 0.5) * radiusY * 0.2,
    height,
  ];
  const out: Mesh = [...polygon(rings[0]!, mat)];
  for (let level = 0; level + 1 < rings.length; level++)
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      out.push(
        ...quad(
          [rings[level]![i]!, rings[level]![j]!, rings[level + 1]![j]!, rings[level + 1]![i]!],
          mat,
        ),
      );
    }
  const top = rings[rings.length - 1]!;
  for (let i = 0; i < segments; i++)
    out.push({ v: [top[i]!, top[(i + 1) % segments]!, apex], material: mat });
  return out;
}

/** Flat annulus between two radii at height `z`. */
function ring(
  radius0: number,
  radius1: number,
  z: number,
  segments: number,
  mat: ReturnType<typeof material>,
): Mesh {
  const at = (r: number, i: number): Vec3 => {
    const a = (i / segments) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r, z];
  };
  return Array.from({ length: segments }, (_, i) =>
    quad([at(radius0, i), at(radius0, i + 1), at(radius1, i + 1), at(radius1, i)], mat),
  ).flat();
}

/** Thin tapered stalk leaning from `base` to `tip`. */
function stalk(base: Vec3, tip: Vec3, width: number, mat: ReturnType<typeof material>): Mesh {
  return beam(base, tip, width, mat);
}

/** Tilts a mesh about a horizontal axis through (y, z) so a flat disc faces the viewer. */
function tilted(mesh: Mesh, angle: number, y: number, z: number): Mesh {
  return rotateX(mesh, angle, y, z);
}

export function sunflowerPatchMesh(): Mesh {
  const plants: ReadonlyArray<readonly [number, number, number]> = [
    [-0.22, -0.14, 0.78],
    [0.02, -0.26, 0.62],
    [0.2, -0.04, 0.84],
    [-0.08, 0.1, 0.7],
    [0.18, 0.24, 0.6],
    [-0.28, 0.2, 0.55],
  ];
  const head = COLOUR('yellow');
  const seeds = COLOUR('wood');
  return [
    ...box([-0.4, -0.38, 0], [0.4, 0.38, 0.03], SOIL),
    ...plants.flatMap(([x, y, top]) => [
      ...stalk([x, y, 0.03], [x, y, top], 0.025, LEAF),
      ...box([x - 0.07, y - 0.012, top * 0.35], [x + 0.07, y + 0.012, top * 0.35 + 0.025], GRASS),
      ...tilted(
        cylinder(x, y, top, top + 0.025, 0.1, 0.1, 10, head, { capTop: true, capBottom: true }),
        0.5,
        y,
        top,
      ),
      ...tilted(
        cylinder(x, y, top + 0.025, top + 0.045, 0.045, 0.045, 8, seeds, { capTop: true }),
        0.5,
        y,
        top,
      ),
    ]),
  ];
}

export function lavenderRowsMesh(): Mesh {
  const out: Mesh = [...box([-0.42, -0.4, 0], [0.42, 0.4, 0.025], SOIL)];
  const next = sequence(14);
  for (const x of [-0.27, 0, 0.27])
    for (let k = 0; k < 5; k++) {
      const y = -0.34 + k * 0.17;
      out.push(...box([x - 0.075, y - 0.06, 0.02], [x + 0.075, y + 0.06, 0.13], LEAF));
      for (let spike = 0; spike < 3; spike++) {
        const sx = x + (spike - 1) * 0.045;
        const sy = y + (next() - 0.5) * 0.05;
        const top = 0.26 + next() * 0.07;
        out.push(
          ...box([sx - 0.014, sy - 0.014, 0.12], [sx + 0.014, sy + 0.014, top], COLOUR('purple')),
        );
      }
    }
  return out;
}

export function roseArchMesh(): Mesh {
  const rose = [COLOUR('red'), COLOUR('pink'), COLOUR('white')];
  const centre: Vec3 = [0, 0, 0.72];
  const radius = 0.34;
  const arc = Array.from({ length: 9 }, (_, i): Vec3 => {
    const angle = (i / 8) * Math.PI;
    return [0, -Math.cos(angle) * radius, centre[2] + Math.sin(angle) * radius];
  });
  const next = sequence(15);
  const out: Mesh = [
    ...box([-0.04, -0.375, 0], [0.04, -0.295, 0.72], WOOD),
    ...box([-0.04, 0.295, 0], [0.04, 0.375, 0.72], WOOD),
  ];
  for (let i = 0; i + 1 < arc.length; i++)
    out.push(...beam(arc[i]!, arc[i + 1]!, 0.055, WOOD, 0.08));
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const angle = t * Math.PI;
    const y = -Math.cos(angle) * radius;
    const z = t < 0.18 || t > 0.82 ? 0.18 + next() * 0.5 : centre[2] + Math.sin(angle) * radius;
    const side = t < 0.18 ? -0.34 : t > 0.82 ? 0.34 : y;
    const x = (next() - 0.5) * 0.12;
    out.push(
      ...box([x - 0.05, side - 0.045, z - 0.03], [x + 0.05, side + 0.045, z + 0.04], LEAF),
      ...box([x - 0.035, side - 0.03, z], [x + 0.04, side + 0.03, z + 0.07], rose[i % 3]!),
    );
  }
  return out;
}

export function flowerUrnMesh(): Mesh {
  const blooms = [COLOUR('pink'), COLOUR('yellow'), COLOUR('orange'), COLOUR('white')];
  const out: Mesh = [
    ...cylinder(0, 0, 0, 0.05, 0.19, 0.17, 10, STONE, { capTop: true }),
    ...cylinder(0, 0, 0.05, 0.3, 0.1, 0.18, 10, STONE),
    ...cylinder(0, 0, 0.3, 0.35, 0.22, 0.22, 10, STONE, { capTop: true }),
    ...cylinder(0, 0, 0.35, 0.37, 0.17, 0.17, 10, SOIL, { capTop: true }),
  ];
  const next = sequence(16);
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2;
    const reach = i % 3 === 0 ? 0.03 : 0.12;
    const x = Math.cos(angle) * reach;
    const y = Math.sin(angle) * reach;
    const z = 0.4 + (i % 3 === 0 ? 0.12 : 0.04) + next() * 0.03;
    out.push(
      ...box([x - 0.045, y - 0.045, 0.37], [x + 0.045, y + 0.045, z], LEAF),
      ...box([x - 0.05, y - 0.05, z], [x + 0.05, y + 0.05, z + 0.06], blooms[i % 4]!),
    );
  }
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + 0.4;
    const x = Math.cos(angle) * 0.22;
    const y = Math.sin(angle) * 0.22;
    out.push(...box([x - 0.025, y - 0.025, 0.27], [x + 0.025, y + 0.025, 0.36], GRASS));
  }
  return out;
}

export function planterBoxMesh(): Mesh {
  const blooms = [COLOUR('red'), COLOUR('white'), COLOUR('orange'), COLOUR('pink')];
  const out: Mesh = [
    ...box([-0.14, -0.31, 0.02], [0.14, 0.31, 0.2], TIMBER),
    ...box([-0.14, -0.31, 0], [-0.1, -0.27, 0.22], WOOD),
    ...box([0.1, -0.31, 0], [0.14, -0.27, 0.22], WOOD),
    ...box([-0.14, 0.27, 0], [-0.1, 0.31, 0.22], WOOD),
    ...box([0.1, 0.27, 0], [0.14, 0.31, 0.22], WOOD),
    ...box([-0.12, -0.29, 0.19], [0.12, 0.29, 0.22], SOIL),
  ];
  for (let i = 0; i < 6; i++) {
    const y = -0.24 + i * 0.096;
    for (const x of [-0.05, 0.06]) {
      const top = 0.36 + ((i + (x > 0 ? 1 : 0)) % 3) * 0.04;
      out.push(
        ...box([x - 0.012, y - 0.012, 0.21], [x + 0.012, y + 0.012, top], LEAF),
        ...box(
          [x - 0.035, y - 0.035, top],
          [x + 0.035, y + 0.035, top + 0.06],
          blooms[(i + (x > 0 ? 2 : 0)) % 4]!,
        ),
      );
    }
  }
  return out;
}

export function boulderMesh(): Mesh {
  return [...rock(0, 0, 0.3, 0.26, 0.5, 18), ...rock(0.2, -0.12, 0.09, 0.08, 0.1, 118)];
}

export function rockClusterMesh(): Mesh {
  return [
    ...rock(-0.16, -0.08, 0.2, 0.18, 0.3, 19),
    ...rock(0.14, 0.1, 0.16, 0.15, 0.22, 29),
    ...rock(0.06, -0.26, 0.1, 0.09, 0.12, 39),
    ...rock(-0.24, 0.24, 0.07, 0.06, 0.07, 49),
    ...box([-0.26, -0.14, 0.24], [-0.04, 0.02, 0.29], COLOUR('grass')),
  ];
}

export function fallenLogMesh(): Mesh {
  const barrel = cylinder(0, 0, -0.4, 0.4, 0.11, 0.1, 10, WOOD);
  const lengthways = (mesh: Mesh): Mesh =>
    translateMesh(rotateY(mesh, Math.PI / 2, 0, 0), 0, 0, 0.11);
  const end = (z: number, z2: number): Mesh =>
    lengthways(cylinder(0, 0, z, z2, 0.1, 0.1, 10, TIMBER, { capTop: true, capBottom: true }));
  return [
    ...lengthways(barrel),
    ...end(-0.405, -0.39),
    ...end(0.39, 0.405),
    ...box([-0.2, -0.09, 0.2], [0.05, 0.09, 0.235], COLOUR('grass')),
    ...beam([0.12, 0, 0.2], [0.2, 0.17, 0.3], 0.04, WOOD),
    ...box([0.16, 0.14, 0.28], [0.26, 0.2, 0.3], LEAF),
  ];
}

export function treeStumpMesh(): Mesh {
  const out: Mesh = [
    ...cylinder(0, 0, 0, 0.22, 0.2, 0.15, 9, WOOD),
    ...cylinder(0, 0, 0.22, 0.235, 0.15, 0.15, 9, TIMBER, { capTop: true }),
    ...cylinder(0, 0, 0.235, 0.245, 0.08, 0.08, 9, material(ramp('timber'), { levelBias: -1 }), {
      capTop: true,
    }),
  ];
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + 0.5;
    out.push(
      ...beam(
        [Math.cos(angle) * 0.1, Math.sin(angle) * 0.1, 0.1],
        [Math.cos(angle) * 0.27, Math.sin(angle) * 0.27, 0.02],
        0.07,
        WOOD,
      ),
    );
  }
  return out;
}

export function reedClumpMesh(): Mesh {
  const next = sequence(22);
  const out: Mesh = [...box([-0.3, -0.3, 0], [0.3, 0.3, 0.02], SOIL)];
  for (let i = 0; i < 16; i++) {
    const angle = next() * Math.PI * 2;
    const reach = next() * 0.22;
    const x = Math.cos(angle) * reach;
    const y = Math.sin(angle) * reach;
    const top = 0.6 + next() * 0.32;
    const lean = (next() - 0.5) * 0.14;
    out.push(...stalk([x, y, 0.02], [x + lean, y - lean * 0.6, top], 0.022, i % 2 ? LEAF : GRASS));
    if (i % 5 === 0)
      out.push(
        ...box(
          [x + lean - 0.022, y - lean * 0.6 - 0.022, top - 0.14],
          [x + lean + 0.022, y - lean * 0.6 + 0.022, top],
          WOOD,
        ),
      );
  }
  return out;
}

function waterArcs(height: number, bowlRadius: number, count: number, spread: number): Mesh {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + 0.3;
    return [
      ...beam(
        [0, 0, height],
        [Math.cos(angle) * spread * 0.6, Math.sin(angle) * spread * 0.6, height - 0.02],
        0.018,
        FOAM,
      ),
      ...beam(
        [Math.cos(angle) * spread * 0.6, Math.sin(angle) * spread * 0.6, height - 0.02],
        [Math.cos(angle) * bowlRadius, Math.sin(angle) * bowlRadius, height - 0.2],
        0.018,
        FOAM,
      ),
    ];
  }).flat();
}

export function tieredFountainMesh(): Mesh {
  return [
    ...cylinder(0, 0, 0, 0.14, 0.42, 0.4, 12, STONE, { capTop: true }),
    ...cylinder(0, 0, 0.14, 0.15, 0.35, 0.35, 12, WATER, { capTop: true }),
    ...cylinder(0, 0, 0.15, 0.5, 0.07, 0.05, 8, STONE),
    ...cylinder(0, 0, 0.5, 0.56, 0.07, 0.27, 12, STONE),
    ...cylinder(0, 0, 0.56, 0.6, 0.27, 0.27, 12, STONE, { capTop: true }),
    ...cylinder(0, 0, 0.6, 0.61, 0.2, 0.2, 12, WATER, { capTop: true }),
    ...cylinder(0, 0, 0.6, 0.78, 0.035, 0.03, 8, STONE),
    ...cylinder(0, 0, 0.78, 0.88, 0.035, 0.0, 8, FOAM),
    ...waterArcs(0.76, 0.26, 6, 0.2),
    ...Array.from({ length: 6 }, (_, i) => {
      const angle = (i / 6) * Math.PI * 2 + 0.3;
      return beam(
        [Math.cos(angle) * 0.27, Math.sin(angle) * 0.27, 0.58],
        [Math.cos(angle) * 0.35, Math.sin(angle) * 0.35, 0.16],
        0.015,
        FOAM,
      );
    }).flat(),
  ];
}

export function jetFountainMesh(): Mesh {
  const jets = Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2;
    const tip: Vec3 = [Math.cos(angle) * 0.1, Math.sin(angle) * 0.1, 0.56];
    const end: Vec3 = [Math.cos(angle) * 0.3, Math.sin(angle) * 0.3, 0.2];
    return [...beam([0, 0, 0.4], tip, 0.02, FOAM), ...beam(tip, end, 0.02, FOAM)];
  }).flat();
  return [
    ...cylinder(0, 0, 0, 0.12, 0.46, 0.46, 8, STONE, { capTop: true }),
    ...cylinder(0, 0, 0.12, 0.24, 0.46, 0.46, 8, STONE, { capTop: false }),
    ...cylinder(0, 0, 0.12, 0.24, 0.38, 0.38, 8, STONE, { capTop: false }),
    ...ring(0.38, 0.46, 0.24, 8, material(ramp('stone'), { levelBias: 1 })),
    ...cylinder(0, 0, 0.12, 0.19, 0.38, 0.38, 8, WATER, { capTop: true }),
    ...cylinder(0, 0, 0.19, 0.36, 0.07, 0.05, 8, STONE),
    ...cylinder(0, 0, 0.36, 0.42, 0.05, 0.05, 8, FOAM, { capTop: true }),
    ...cylinder(0, 0, 0.42, 0.62, 0.035, 0.015, 8, FOAM),
    ...jets,
  ];
}

export function gardenStatueMesh(): Mesh {
  return [
    ...box([-0.17, -0.17, 0], [0.17, 0.17, 0.07], STONE),
    ...box([-0.13, -0.13, 0.07], [0.13, 0.13, 0.3], STONE),
    ...box([-0.15, -0.15, 0.3], [0.15, 0.15, 0.34], STONE),
    ...cylinder(0, 0, 0.34, 0.66, 0.115, 0.07, 9, MARBLE),
    ...box([-0.06, -0.14, 0.62], [0.06, 0.14, 0.72], MARBLE),
    ...cylinder(0, 0, 0.72, 0.78, 0.04, 0.04, 8, MARBLE),
    ...cylinder(0, 0, 0.78, 0.9, 0.065, 0.06, 9, MARBLE, { capTop: true }),
    ...box([0.02, -0.04, 0.82], [0.075, 0.04, 0.86], MARBLE),
    ...beam([0.02, -0.12, 0.68], [0.3, -0.12, 0.9], 0.05, MARBLE),
    ...beam([0, 0.12, 0.66], [0.06, 0.15, 0.46], 0.05, MARBLE),
    ...box([0.26, -0.15, 0.9], [0.34, -0.09, 0.97], BRASS),
  ];
}

export function obeliskMesh(): Mesh {
  return [
    ...box([-0.17, -0.17, 0], [0.17, 0.17, 0.08], STONE),
    ...box([-0.14, -0.14, 0.08], [0.14, 0.14, 0.15], STONE),
    ...cylinder(0, 0, 0.15, 0.98, 0.15, 0.075, 4, MARBLE, { phase: Math.PI / 4 }),
    ...cylinder(0, 0, 0.98, 1.16, 0.075, 0, 4, BRASS, { phase: Math.PI / 4 }),
  ];
}

export function sundialMesh(): Mesh {
  return [
    ...cylinder(0, 0, 0, 0.06, 0.2, 0.17, 6, STONE, { capTop: true }),
    ...cylinder(0, 0, 0.06, 0.34, 0.12, 0.1, 6, STONE),
    ...cylinder(0, 0, 0.34, 0.38, 0.25, 0.25, 12, STONE, { capTop: true }),
    ...cylinder(0, 0, 0.38, 0.4, 0.22, 0.22, 12, BRASS, { capTop: true }),
    ...box([-0.2, -0.01, 0.4], [0.2, 0.01, 0.405], BRICK),
    ...box([-0.01, -0.2, 0.4], [0.01, 0.2, 0.405], BRICK),
    ...polygon(
      [
        [-0.12, 0, 0.4],
        [0.12, 0, 0.4],
        [-0.12, 0, 0.6],
      ],
      STEEL,
    ),
    ...polygon(
      [
        [-0.12, 0.015, 0.4],
        [0.12, 0.015, 0.4],
        [-0.12, 0.015, 0.6],
      ],
      STEEL,
    ),
  ];
}

export function signBoardMesh(): Mesh {
  const stripes = material(ramp('red'), {
    shader: (p, level) => {
      const across = (p[1] / 1.15 + 0.4) / 0.8;
      const up = (p[2] / PHYSICAL_Z / 1.15 - 0.47) / 0.29;
      if (up < 0.2 || up > 0.8 || across < 0.05 || across > 0.95)
        return ramp('yellow')[Math.min(level, 4)]!;
      return Math.floor(across * 9) % 2 === 0 && up > 0.35 && up < 0.65
        ? ramp('white')[Math.min(level + 1, 4)]!
        : ramp('red')[Math.min(level, 4)]!;
    },
  });
  return [
    ...box([-0.04, -0.34, 0], [0.04, -0.28, 0.5], WOOD),
    ...box([-0.04, 0.28, 0], [0.04, 0.34, 0.5], WOOD),
    ...box([-0.035, -0.4, 0.47], [0.035, 0.4, 0.76], stripes),
    ...box([-0.045, -0.405, 0.76], [0.045, 0.405, 0.79], WOOD),
    ...box([-0.045, -0.405, 0.45], [0.045, 0.405, 0.47], WOOD),
  ];
}

export function flagpoleMesh(): Mesh {
  const flag = material(ramp('red'), {
    shader: (p, level) => {
      const stripe = Math.floor((p[2] - 1.5) / 0.1) % 2 === 0;
      return stripe ? ramp('red')[Math.min(level + 1, 4)]! : ramp('white')[Math.min(level + 1, 4)]!;
    },
  });
  const wave = (x: number): number => Math.sin(x * 9) * 0.035;
  const flagParts = Array.from({ length: 4 }, (_, i) => {
    const x0 = 0.03 + i * 0.1;
    const x1 = x0 + 0.1;
    return quad(
      [
        [x0, wave(x0), 1.82],
        [x1, wave(x1), 1.82],
        [x1, wave(x1), 1.5],
        [x0, wave(x0), 1.5],
      ],
      flag,
    );
  }).flat();
  return [
    ...cylinder(0, 0, 0, 0.06, 0.12, 0.1, 8, STONE, { capTop: true }),
    ...cylinder(0, 0, 0.06, 2.05, 0.028, 0.018, 8, STEEL),
    ...cylinder(0, 0, 2.05, 2.12, 0.04, 0.0, 8, BRASS),
    ...flagParts,
  ];
}

export function scarecrowMesh(): Mesh {
  const shirt = material(ramp('blue'), {
    shader: (p, level) => {
      const check = (Math.floor((p[1] + 1) / 0.05) + Math.floor(p[2] / 0.05)) % 2 === 0;
      return ramp(check ? 'blue' : 'white')[Math.min(level + (check ? 0 : 1), 4)]!;
    },
  });
  const hay = COLOUR('yellow');
  const hat = COLOUR('timber');
  const hatBand = COLOUR('red');
  return [
    ...stalk([0, 0, 0], [0, 0, 0.88], 0.05, WOOD),
    ...box([-0.04, -0.4, 0.62], [0.04, 0.4, 0.68], WOOD),
    ...box([-0.1, -0.1, 0.36], [0.1, 0.1, 0.68], shirt),
    ...box([-0.08, -0.4, 0.58], [0.08, -0.3, 0.72], shirt),
    ...box([-0.08, 0.3, 0.58], [0.08, 0.4, 0.72], shirt),
    ...box([-0.05, -0.46, 0.56], [0.05, -0.38, 0.62], hay),
    ...box([-0.05, 0.38, 0.56], [0.05, 0.46, 0.62], hay),
    ...box([-0.06, -0.08, 0.25], [0.06, 0.08, 0.37], hay),
    ...cylinder(0, 0, 0.68, 0.8, 0.075, 0.075, 8, TIMBER, { capTop: true }),
    ...box([0.07, -0.03, 0.73], [0.09, -0.01, 0.75], WOOD),
    ...box([0.07, 0.01, 0.73], [0.09, 0.03, 0.75], WOOD),
    ...cylinder(0, 0, 0.79, 0.81, 0.17, 0.17, 10, hat, { capTop: true }),
    ...cylinder(0, 0, 0.81, 0.92, 0.09, 0.07, 10, hat, { capTop: true }),
    ...cylinder(0, 0, 0.81, 0.84, 0.095, 0.095, 10, hatBand),
  ];
}

export function wishingWellMesh(): Mesh {
  const ROOF = COLOUR('red');
  const roofLeft = quad(
    [
      [-0.04, -0.4, 1.12],
      [-0.04, 0.4, 1.12],
      [-0.36, 0.4, 0.9],
      [-0.36, -0.4, 0.9],
    ],
    ROOF,
  );
  const roofRight = quad(
    [
      [0.04, -0.4, 1.12],
      [0.04, 0.4, 1.12],
      [0.36, 0.4, 0.9],
      [0.36, -0.4, 0.9],
    ],
    ROOF,
  );
  return [
    ...cylinder(0, 0, 0, 0.32, 0.32, 0.3, 8, STONE),
    ...cylinder(0, 0, 0.32, 0.36, 0.34, 0.34, 8, STONE, { capTop: true }),
    ...cylinder(0, 0, 0.36, 0.365, 0.2, 0.2, 8, material(ramp('glass'), { fixedLevel: 1 }), {
      capTop: true,
    }),
    ...box([-0.04, -0.3, 0.32], [0.04, -0.22, 1.0], WOOD),
    ...box([-0.04, 0.22, 0.32], [0.04, 0.3, 1.0], WOOD),
    ...beam([0, -0.3, 0.74], [0, 0.3, 0.74], 0.04, TIMBER),
    ...beam([0, 0.02, 0.74], [0, 0.02, 0.5], 0.012, STEEL),
    ...box([-0.04, -0.02, 0.4], [0.04, 0.06, 0.5], TIMBER),
    ...roofLeft,
    ...roofRight,
    ...box([-0.05, -0.4, 1.1], [0.05, 0.4, 1.14], WOOD),
    ...polygon(
      [
        [-0.04, -0.4, 1.12],
        [0.04, -0.4, 1.12],
        [0.36, -0.4, 0.9],
        [-0.36, -0.4, 0.9],
      ],
      WOOD,
    ),
    ...polygon(
      [
        [-0.04, 0.4, 1.12],
        [0.04, 0.4, 1.12],
        [0.36, 0.4, 0.9],
        [-0.36, 0.4, 0.9],
      ],
      WOOD,
    ),
  ];
}

/** Uniform scale about the tile centre, keeping the model on the ground. */
function scaled(build: () => Mesh, factor: number): () => Mesh {
  return () => mapMesh(build(), (p) => [p[0] * factor, p[1] * factor, p[2] * factor]);
}

/** Model builders keyed by catalog sprite name. */
export const SCENERY_MODELS: Readonly<Record<string, () => Mesh>> = {
  'sunflower-patch': sunflowerPatchMesh,
  'lavender-rows': lavenderRowsMesh,
  'rose-arch': roseArchMesh,
  'flower-urn': scaled(flowerUrnMesh, 1.25),
  'planter-box': scaled(planterBoxMesh, 1.2),
  boulder: scaled(boulderMesh, 1.3),
  'rock-cluster': scaled(rockClusterMesh, 1.25),
  'fallen-log': scaled(fallenLogMesh, 1.3),
  'tree-stump': scaled(treeStumpMesh, 1.4),
  'reed-clump': reedClumpMesh,
  'tiered-fountain': scaled(tieredFountainMesh, 1.1),
  'jet-fountain': scaled(jetFountainMesh, 1.1),
  'garden-statue': scaled(gardenStatueMesh, 1.1),
  obelisk: obeliskMesh,
  sundial: scaled(sundialMesh, 1.25),
  'park-signboard': scaled(signBoardMesh, 1.15),
  flagpole: flagpoleMesh,
  scarecrow: scaled(scarecrowMesh, 1.15),
  'wishing-well': wishingWellMesh,
};
