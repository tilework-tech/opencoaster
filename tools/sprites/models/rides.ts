import {
  beam,
  box,
  cylinder,
  material,
  orientedBox,
  physicalToLevels,
  quad,
  rotateY,
  rotateZ,
  translateMesh,
} from '../mesh';
import type { Material, Mesh, Vec3 } from '../mesh';
import { ramp } from '../palette';

const mat = (name: string): Material => material(ramp(name));
const WHITE = mat('white');
const RED = mat('red');
const BLUE = mat('blue');
const YELLOW = mat('yellow');
const GREEN = mat('green');
const ORANGE = mat('orange');
const PINK = mat('pink');
const PURPLE = mat('purple');
const STEEL = mat('steel');
const WOOD = mat('wood');
const TIMBER = mat('timber');
const GLASS = mat('glass');
const STONE = mat('stone');
const BRICK = mat('brick');

export interface RideModel {
  /** Manifest key without view suffix, e.g. `rides/merry-go-round`. */
  key: string;
  frames: number;
  /** Mesh for operating frame `frame`, authored in physical tile units around the tile centre. */
  build: (frame: number) => Mesh;
}

/** Cone or truncated cone whose side panels alternate between two materials. */
function stripedCone(
  z0: number,
  z1: number,
  r0: number,
  r1: number,
  segments: number,
  a: Material,
  b: Material,
): Mesh {
  const out: Mesh = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    out.push(
      ...quad(
        [
          [Math.cos(a0) * r0, Math.sin(a0) * r0, z0],
          [Math.cos(a1) * r0, Math.sin(a1) * r0, z0],
          [Math.cos(a1) * r1, Math.sin(a1) * r1, z1],
          [Math.cos(a0) * r1, Math.sin(a0) * r1, z1],
        ],
        i % 2 === 0 ? a : b,
      ),
    );
  }
  return out;
}

function horse(x: number, y: number, z: number, heading: number, coat: Material): Mesh {
  const parts: Mesh = [
    ...box([-0.07, -0.025, 0.035], [0.06, 0.025, 0.085], coat),
    ...box([0.045, -0.02, 0.07], [0.095, 0.02, 0.13], coat),
    ...box([-0.065, -0.02, 0], [-0.04, 0.02, 0.04], WOOD),
    ...box([0.03, -0.02, 0], [0.055, 0.02, 0.04], WOOD),
    ...box([-0.085, -0.01, 0.07], [-0.065, 0.01, 0.1], WOOD),
  ];
  return translateMesh(rotateZ(parts, heading), x, y, z);
}

function merryGoRound(frame: number): Mesh {
  const mesh: Mesh = [];
  mesh.push(...cylinder(0, 0, 0, 0.04, 0.47, 0.47, 16, RED, { capBottom: true }));
  mesh.push(...cylinder(0, 0, 0.04, 0.06, 0.44, 0.44, 16, TIMBER, { capBottom: true }));
  mesh.push(...cylinder(0, 0, 0.06, 0.5, 0.07, 0.07, 8, WHITE));
  const coats = [WHITE, PINK, YELLOW, BLUE];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + (frame * Math.PI) / 16;
    const cx = Math.cos(angle) * 0.3;
    const cy = Math.sin(angle) * 0.3;
    const bob = 0.04 + 0.04 * (1 + Math.sin(i * 1.7 + frame * 0.9)) * 0.5 * (i % 2 === 0 ? 1 : 0.6);
    mesh.push(...cylinder(cx, cy, 0.06, 0.5, 0.014, 0.014, 4, YELLOW));
    mesh.push(...horse(cx, cy, 0.1 + bob, angle + Math.PI / 2, coats[i % 4]));
  }
  mesh.push(...cylinder(0, 0, 0.5, 0.5, 0.47, 0.47, 16, WOOD, { capBottom: true, capTop: false }));
  mesh.push(...stripedCone(0.5, 0.74, 0.5, 0.05, 8, RED, WHITE));
  mesh.push(...cylinder(0, 0, 0.74, 0.84, 0.03, 0.01, 6, YELLOW));
  return mesh;
}

function swingingShip(frame: number): Mesh {
  const mesh: Mesh = [];
  const axleZ = 0.62;
  const swing = [0, 14, 25, 14, 0, -14, -25, -14][frame % 8] * (Math.PI / 180);
  for (const y of [-0.36, 0.36]) {
    mesh.push(...beam([-0.3, y, 0.02], [0, y, axleZ], 0.05, WHITE));
    mesh.push(...beam([0.3, y, 0.02], [0, y, axleZ], 0.05, WHITE));
    mesh.push(...beam([-0.3, y, 0.02], [0.3, y, 0.02], 0.04, STEEL));
  }
  mesh.push(...beam([0, -0.4, axleZ], [0, 0.4, axleZ], 0.04, STEEL));
  const boat: Mesh = [
    ...beam([0, -0.22, axleZ], [0, -0.22, 0.24], 0.025, STEEL),
    ...beam([0, 0.22, axleZ], [0, 0.22, 0.24], 0.025, STEEL),
    ...box([-0.1, -0.3, 0.14], [0.1, 0.3, 0.2], RED),
    ...box([-0.1, -0.3, 0.2], [-0.07, 0.3, 0.26], WHITE),
    ...box([0.07, -0.3, 0.2], [0.1, 0.3, 0.26], WHITE),
    ...box([-0.1, -0.3, 0.2], [0.1, -0.27, 0.34], YELLOW),
    ...box([-0.1, 0.27, 0.2], [0.1, 0.3, 0.34], YELLOW),
    ...box([-0.06, -0.2, 0.2], [0.06, 0.2, 0.23], BLUE),
  ];
  mesh.push(...rotateY(boat, swing, 0, axleZ));
  return mesh;
}

function ferrisWheel(frame: number): Mesh {
  const mesh: Mesh = [];
  const hubZ = 0.5;
  const radius = 0.38;
  for (const y of [-0.2, 0.2]) {
    mesh.push(...beam([-0.3, y, 0.02], [0, y, hubZ], 0.045, WHITE));
    mesh.push(...beam([0.3, y, 0.02], [0, y, hubZ], 0.045, WHITE));
  }
  mesh.push(...beam([-0.3, -0.2, 0.02], [-0.3, 0.2, 0.02], 0.035, STEEL));
  mesh.push(...beam([0.3, -0.2, 0.02], [0.3, 0.2, 0.02], 0.035, STEEL));
  mesh.push(...beam([0, -0.22, hubZ], [0, 0.22, hubZ], 0.04, STEEL));
  const rotation = (frame * Math.PI) / 16;
  const rim = (a: number, y: number): Vec3 => [
    Math.cos(a) * radius,
    y,
    hubZ + Math.sin(a) * radius,
  ];
  const gondolas = [RED, YELLOW];
  for (let i = 0; i < 16; i++) {
    const a0 = rotation + (i / 16) * Math.PI * 2;
    const a1 = rotation + ((i + 1) / 16) * Math.PI * 2;
    for (const y of [-0.08, 0.08]) {
      mesh.push(...beam(rim(a0, y), rim(a1, y), 0.03, WHITE));
      if (i % 2 === 0) mesh.push(...beam([0, y, hubZ], rim(a0, y), 0.02, STEEL));
    }
    if (i % 2 === 0) {
      const p = rim(a0, 0);
      mesh.push(...beam([p[0], -0.08, p[2]], [p[0], 0.08, p[2]], 0.02, STEEL));
      mesh.push(
        ...box(
          [p[0] - 0.05, -0.07, p[2] - 0.11],
          [p[0] + 0.05, 0.07, p[2] - 0.03],
          gondolas[(i / 2) % 2],
        ),
      );
      mesh.push(
        ...box([p[0] - 0.05, -0.07, p[2] - 0.03], [p[0] + 0.05, 0.07, p[2] - 0.015], WHITE),
      );
    }
  }
  return mesh;
}

function twist(frame: number): Mesh {
  const mesh: Mesh = [];
  mesh.push(...cylinder(0, 0, 0, 0.05, 0.47, 0.47, 16, STONE, { capBottom: true }));
  mesh.push(...cylinder(0, 0, 0.05, 0.4, 0.07, 0.07, 8, STEEL));
  mesh.push(...stripedCone(0.4, 0.5, 0.12, 0.02, 6, YELLOW, ORANGE));
  const phase = (frame * Math.PI) / 6;
  for (let i = 0; i < 3; i++) {
    const a = phase + (i / 3) * Math.PI * 2;
    const cx = Math.cos(a) * 0.3;
    const cy = Math.sin(a) * 0.3;
    mesh.push(...beam([0, 0, 0.12], [cx, cy, 0.12], 0.035, STEEL));
    mesh.push(...beam([cx, cy, 0.05], [cx, cy, 0.12], 0.03, STEEL));
    const spin = -frame * (Math.PI / 4) + a * 0.5;
    const car: Mesh = [
      ...cylinder(cx, cy, 0.1, 0.16, 0.13, 0.13, 10, i % 2 === 0 ? RED : ORANGE, {
        capBottom: true,
      }),
      ...cylinder(cx, cy, 0.16, 0.17, 0.1, 0.1, 10, WHITE),
      ...orientedBox(cx - 0.045, cy, 0.17, 0.03, 0.12, 0.07, 0, BLUE),
      ...orientedBox(cx + 0.045, cy, 0.17, 0.03, 0.12, 0.07, 0, BLUE),
    ];
    mesh.push(...rotateZ(car, spin, cx, cy));
  }
  return mesh;
}

interface StallStyle {
  walls: Material;
  awning: [Material, Material];
  roof: Material;
  sign: Material;
}

/** Counter stall: back wall, side walls, counter and striped awning on the +y side. */
function stall(
  style: StallStyle,
  frame: number,
  kind: 'food' | 'drink' | 'info' | 'toilets',
): Mesh {
  const mesh: Mesh = [];
  const w = 0.36;
  const d = 0.3;
  const h = 0.32;
  if (kind === 'toilets') {
    mesh.push(...box([-0.34, -0.3, 0], [0.34, 0.3, 0.42], style.walls));
    mesh.push(...box([-0.38, -0.34, 0.42], [0.38, 0.34, 0.47], style.roof));
    mesh.push(...box([-0.1, 0.3, 0], [0.1, 0.32, 0.3], WOOD));
    mesh.push(...box([-0.24, 0.3, 0.12], [-0.17, 0.315, 0.28], style.sign));
    mesh.push(...box([0.17, 0.3, 0.12], [0.24, 0.315, 0.28], style.awning[0]));
    mesh.push(...box([-0.3, 0.3, 0.33], [0.3, 0.315, 0.4], style.sign));
    mesh.push(
      ...box([-0.05, 0.315, 0.345], [0.05, 0.325, 0.385], frame % 2 === 0 ? YELLOW : WHITE),
    );
    return mesh;
  }
  mesh.push(...box([-w, -d, 0], [w, -d + 0.04, h + 0.1], style.walls));
  mesh.push(...box([-w, -d, 0], [-w + 0.04, d, h + 0.1], style.walls));
  mesh.push(...box([w - 0.04, -d, 0], [w, d, h + 0.1], style.walls));
  mesh.push(...box([-w, d - 0.08, 0], [w, d, 0.2], style.walls));
  mesh.push(...box([-w - 0.02, d - 0.1, 0.2], [w + 0.02, d + 0.02, 0.23], WOOD));
  const slats = 8;
  for (let i = 0; i < slats; i++) {
    const x0 = -w - 0.03 + (i / slats) * (2 * w + 0.06);
    const x1 = -w - 0.03 + ((i + 1) / slats) * (2 * w + 0.06);
    const sag = 0.015 * Math.sin(((i + frame * 2) / slats) * Math.PI * 2);
    mesh.push(
      ...quad(
        [
          [x0, -0.04, h + 0.2],
          [x1, -0.04, h + 0.2],
          [x1, d + 0.1, h + 0.02 + sag],
          [x0, d + 0.1, h + 0.02 + sag],
        ],
        style.awning[i % 2],
      ),
    );
    mesh.push(
      ...quad(
        [
          [x0, d + 0.1, h + 0.02 + sag],
          [x1, d + 0.1, h + 0.02 + sag],
          [x1, d + 0.1, h - 0.025 + sag],
          [x0, d + 0.1, h - 0.025 + sag],
        ],
        style.awning[i % 2],
      ),
    );
  }
  mesh.push(...box([-w, -d, h + 0.1], [w, -d + 0.05, h + 0.34], style.sign));
  for (let i = 0; i < 5; i++) {
    const lit = (i + frame) % 4 === 0;
    mesh.push(
      ...box(
        [-0.28 + i * 0.14, -d + 0.05, h + 0.27],
        [-0.22 + i * 0.14, -d + 0.07, h + 0.31],
        lit ? WHITE : kind === 'info' ? GREEN : YELLOW,
      ),
    );
  }
  mesh.push(...box([-w, -d, h + 0.2], [w, -0.04, h + 0.23], style.roof));
  if (kind === 'food') {
    mesh.push(...box([-0.12, 0.18, 0.23], [-0.04, 0.26, 0.29], ORANGE));
    mesh.push(...box([0.06, 0.18, 0.23], [0.16, 0.26, 0.28], YELLOW));
  } else if (kind === 'drink') {
    mesh.push(...cylinder(-0.08, 0.2, 0.23, 0.33, 0.04, 0.04, 8, WHITE));
    mesh.push(...cylinder(0.08, 0.2, 0.23, 0.3, 0.035, 0.035, 8, ORANGE));
  } else {
    mesh.push(...box([-0.03, -d + 0.05, h + 0.12], [0.03, -d + 0.08, h + 0.22], WHITE));
  }
  return mesh;
}

const FOOD: StallStyle = {
  walls: mat('timber'),
  awning: [RED, WHITE],
  roof: mat('brick'),
  sign: ORANGE,
};
const DRINK: StallStyle = {
  walls: mat('timber'),
  awning: [BLUE, WHITE],
  roof: mat('blue'),
  sign: PURPLE,
};
const INFO: StallStyle = { walls: WHITE, awning: [GREEN, WHITE], roof: GREEN, sign: BLUE };
const TOILETS: StallStyle = {
  walls: mat('stone'),
  awning: [GLASS, GLASS],
  roof: BRICK,
  sign: BLUE,
};

export const RIDE_MODELS: readonly RideModel[] = [
  { key: 'rides/merry-go-round', frames: 4, build: merryGoRound },
  { key: 'rides/swinging-ship', frames: 8, build: swingingShip },
  { key: 'rides/ferris-wheel', frames: 8, build: ferrisWheel },
  { key: 'rides/twist', frames: 4, build: twist },
  { key: 'rides/food-stall', frames: 4, build: (f) => stall(FOOD, f, 'food') },
  { key: 'rides/drink-stall', frames: 4, build: (f) => stall(DRINK, f, 'drink') },
  { key: 'rides/information-kiosk', frames: 4, build: (f) => stall(INFO, f, 'info') },
  { key: 'rides/toilets', frames: 4, build: (f) => stall(TOILETS, f, 'toilets') },
];

/** The ride mesh in height levels, ready for `renderMesh`. */
export function rideMesh(model: RideModel, frame: number): Mesh {
  return physicalToLevels(model.build(frame));
}
