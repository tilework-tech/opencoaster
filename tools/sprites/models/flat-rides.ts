import {
  beam,
  box,
  cylinder,
  loft,
  mapMesh,
  material,
  orientedBox,
  polygon,
  quad,
  rotateX,
  rotateY,
  rotateZ,
  translateMesh,
} from '../mesh';
import type { Material, Mesh, Vec3 } from '../mesh';
import { ramp } from '../palette';

/**
 * Flat-ride models at their real footprint size, in physical tile units (one tile is 1 x 1; a
 * seated guest is about 0.3 tall, a standing one 0.56). Each model is centred on the centre of its
 * footprint's bounding box at the origin and stands on z = 0.
 *
 * Frames: the idle pose is `frame = -1` where a ride has one that differs; operating poses are
 * `frame = 0..7`.
 */

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
const PAVING = mat('paving');

const TAU = Math.PI * 2;

/** Cone or truncated cone whose side panels alternate between two materials. */
export function stripedCone(
  cx: number,
  cy: number,
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
    const a0 = (i / segments) * TAU;
    const a1 = ((i + 1) / segments) * TAU;
    out.push(
      ...quad(
        [
          [cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0, z0],
          [cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0, z0],
          [cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1, z1],
          [cx + Math.cos(a0) * r1, cy + Math.sin(a0) * r1, z1],
        ],
        i % 2 === 0 ? a : b,
      ),
    );
  }
  return out;
}

/** Slim vertical post. */
function post(x: number, y: number, z0: number, z1: number, radius: number, m: Material): Mesh {
  return cylinder(x, y, z0, z1, radius, radius, 5, m);
}

// ---------------------------------------------------------------------------------------------
// Merry-go-round, 3 x 3

const MGR_RADIUS = 1.38;
const MGR_DECK = 0.12;
const MGR_CANOPY_Z = 0.84;
const MGR_CANOPY_RADIUS = 0.96;

function horse(x: number, y: number, z: number, heading: number, coat: Material): Mesh {
  const parts: Mesh = [
    ...box([-0.17, -0.06, 0.08], [0.15, 0.06, 0.22], coat),
    ...box([0.11, -0.05, 0.18], [0.26, 0.05, 0.38], coat),
    ...box([0.22, -0.04, 0.3], [0.33, 0.04, 0.36], coat),
    ...box([-0.2, -0.04, 0.2], [-0.16, 0.04, 0.3], WOOD),
    ...box([-0.16, -0.05, 0], [-0.1, 0.05, 0.1], WOOD),
    ...box([0.06, -0.05, 0], [0.12, 0.05, 0.1], WOOD),
    ...box([0.0, -0.065, 0.22], [0.1, 0.065, 0.26], RED),
  ];
  return translateMesh(rotateZ(parts, heading), x, y, z);
}

/** Merry-go-round; `frame` 0..7 turns the carousel. */
export function merryGoRound(frame: number): Mesh {
  const mesh: Mesh = [];
  const turn = (Math.max(frame, 0) * Math.PI) / 24;
  mesh.push(
    ...cylinder(0, 0, 0, MGR_DECK, MGR_RADIUS + 0.04, MGR_RADIUS + 0.04, 24, RED, {
      capBottom: true,
    }),
  );
  mesh.push(
    ...cylinder(
      0,
      0,
      MGR_DECK,
      MGR_DECK + 0.015,
      MGR_RADIUS - 0.04,
      MGR_RADIUS - 0.04,
      24,
      TIMBER,
      { capBottom: true },
    ),
  );
  mesh.push(...cylinder(0, 0, MGR_DECK, MGR_CANOPY_Z, 0.3, 0.3, 12, WHITE));
  mesh.push(...cylinder(0, 0, MGR_DECK, 0.5, 0.36, 0.36, 12, YELLOW));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + turn;
    mesh.push(
      ...box(
        [Math.cos(a) * 0.3 - 0.07, Math.sin(a) * 0.3 - 0.07, 0.52],
        [Math.cos(a) * 0.3 + 0.07, Math.sin(a) * 0.3 + 0.07, 0.9],
        i % 2 === 0 ? BLUE : PINK,
      ),
    );
  }
  const coats = [WHITE, PINK, YELLOW, BLUE, ORANGE, GREEN];
  const rings: Array<{ count: number; radius: number }> = [
    { count: 12, radius: 1.06 },
    { count: 7, radius: 0.64 },
  ];
  rings.forEach(({ count, radius }, ring) => {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * TAU + turn * (ring === 0 ? 1 : 1);
      const cx = Math.cos(angle) * radius;
      const cy = Math.sin(angle) * radius;
      const bob = 0.1 + 0.1 * (1 + Math.sin(i * 1.9 + Math.max(frame, 0) * 0.8 + ring)) * 0.5;
      mesh.push(...post(cx, cy, MGR_DECK, MGR_CANOPY_Z, 0.022, YELLOW));
      mesh.push(
        ...horse(
          cx,
          cy,
          MGR_DECK + 0.05 + bob,
          angle + Math.PI / 2,
          coats[(i + ring) % coats.length],
        ),
      );
    }
  });
  mesh.push(
    ...stripedCone(
      0,
      0,
      MGR_CANOPY_Z - 0.15,
      MGR_CANOPY_Z,
      MGR_CANOPY_RADIUS,
      MGR_CANOPY_RADIUS,
      12,
      YELLOW,
      WHITE,
    ),
  );
  mesh.push(
    ...stripedCone(
      0,
      0,
      MGR_CANOPY_Z,
      MGR_CANOPY_Z + 0.06,
      MGR_CANOPY_RADIUS + 0.04,
      MGR_CANOPY_RADIUS + 0.04,
      12,
      WOOD,
      WOOD,
    ),
  );
  mesh.push(
    ...stripedCone(
      0,
      0,
      MGR_CANOPY_Z + 0.06,
      MGR_CANOPY_Z + 0.38,
      MGR_CANOPY_RADIUS + 0.04,
      0.07,
      12,
      RED,
      WHITE,
    ),
  );
  mesh.push(...cylinder(0, 0, MGR_CANOPY_Z + 0.38, MGR_CANOPY_Z + 0.49, 0.05, 0.015, 6, YELLOW));
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) / 12) * TAU;
    mesh.push(
      ...box(
        [
          Math.cos(a) * (MGR_CANOPY_RADIUS + 0.03) - 0.03,
          Math.sin(a) * (MGR_CANOPY_RADIUS + 0.03) - 0.03,
          MGR_CANOPY_Z - 0.1,
        ],
        [
          Math.cos(a) * (MGR_CANOPY_RADIUS + 0.03) + 0.03,
          Math.sin(a) * (MGR_CANOPY_RADIUS + 0.03) + 0.03,
          MGR_CANOPY_Z - 0.04,
        ],
        WHITE,
      ),
    );
  }
  return mesh;
}

/** Seats of the merry-go-round riders for operating frame `frame` (0..7). */
export function merryGoRoundSeats(frame: number): Vec3[] {
  const turn = (frame * Math.PI) / 24;
  return Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * TAU + turn;
    const bob = 0.1 + 0.1 * (1 + Math.sin(i * 1.9 + frame * 0.8)) * 0.5;
    return [Math.cos(angle) * 1.06, Math.sin(angle) * 1.06, MGR_DECK + 0.05 + bob + 0.17] as Vec3;
  });
}

// ---------------------------------------------------------------------------------------------
// Swinging ship, 1 x 5 (long axis y)

export const SHIP_AXLE_Z = 3.4;
const SHIP_ARM = 1.9;
export const SHIP_MAX_SWING_DEGREES = 60;

/** Frames in a swing between two extremes and in the start-up and wind-down swings. */
const SHIP_SWING_FRAMES = 12;
const SHIP_ENDPOINT_SWING_FRAMES = 6;

/**
 * Pendulum angle per pose: the ship leaves rest, swings between successive extremes (each
 * a half-cosine, so it is momentarily still at an extreme and fastest through level), builds to
 * the maximum angle, then loses amplitude until it stops level.
 */
function swingingShipProfile(): number[] {
  const extremes = [
    0,
    20,
    -32,
    44,
    -54,
    SHIP_MAX_SWING_DEGREES,
    -SHIP_MAX_SWING_DEGREES,
    SHIP_MAX_SWING_DEGREES,
    -SHIP_MAX_SWING_DEGREES,
    52,
    -36,
    18,
    0,
  ];
  const angles = [0];
  for (let i = 1; i < extremes.length; i++) {
    const from = extremes[i - 1]!;
    const to = extremes[i]!;
    const frames =
      i === 1 || i === extremes.length - 1 ? SHIP_ENDPOINT_SWING_FRAMES : SHIP_SWING_FRAMES;
    for (let step = 1; step <= frames; step++) {
      angles.push(from + ((to - from) * (1 - Math.cos((step / frames) * Math.PI))) / 2);
    }
  }
  return angles;
}

export const SHIP_SWING_DEGREES = swingingShipProfile();

function shipHull(): Mesh {
  const mesh: Mesh = [];
  const stations = 14;
  const length = 1.8;
  const section = (t: number): Vec3[] => {
    const y = t * length;
    const rise = Math.abs(t) ** 3 * 0.6;
    const width = 0.34 * (1 - 0.5 * Math.abs(t) ** 3);
    const sideTop = 0.4 + rise;
    return [
      [-width, y, sideTop],
      [-width * 0.78, y, 0.04],
      [width * 0.78, y, 0.04],
      [width, y, sideTop],
    ];
  };
  for (let i = 0; i < stations; i++) {
    const a = section((i / stations) * 2 - 1);
    const b = section(((i + 1) / stations) * 2 - 1);
    mesh.push(...loft(a, b, i % 2 === 0 ? RED : mat('brick')));
  }
  // deck, rails and prow ornaments
  mesh.push(...box([-0.3, -1.6, 0.1], [0.3, 1.6, 0.16], BLUE));
  mesh.push(...box([-0.34, -1.62, 0.38], [-0.3, 1.62, 0.42], YELLOW));
  mesh.push(...box([0.3, -1.62, 0.38], [0.34, 1.62, 0.42], YELLOW));
  for (const s of [-1, 1]) {
    mesh.push(...beam([0, s * 1.6, 0.5], [0, s * 1.78, 1.0], 0.1, YELLOW));
    mesh.push(...box([-0.08, s * 1.76 - 0.06, 0.98], [0.08, s * 1.76 + 0.06, 1.12], WHITE));
  }
  for (let i = -4; i <= 4; i++)
    mesh.push(...box([-0.3, i * 0.38 - 0.03, 0.16], [0.3, i * 0.38 + 0.03, 0.4], WHITE));
  return mesh;
}

function rotateShipPoint(point: Vec3, swing: number): Vec3 {
  const [x, y, z] = point;
  const dy = y;
  const dz = z - SHIP_AXLE_Z;
  return [
    x,
    dy * Math.cos(swing) - dz * Math.sin(swing),
    SHIP_AXLE_Z + dy * Math.sin(swing) + dz * Math.cos(swing),
  ];
}

/** Hull mesh after rotation around the crosswise axle. */
export function swingingShipHull(frame: number): Mesh {
  const swing = ((SHIP_SWING_DEGREES[frame] ?? 0) * Math.PI) / 180;
  const hullTop = SHIP_AXLE_Z - SHIP_ARM;
  return rotateX(translateMesh(shipHull(), 0, 0, hullTop - 0.04), swing, 0, SHIP_AXLE_Z);
}

/** Axle and hull attachment points for the two rigid pendulum arms. */
export function swingingShipArmEndpoints(frame: number): Array<readonly [Vec3, Vec3]> {
  const swing = ((SHIP_SWING_DEGREES[frame] ?? 0) * Math.PI) / 180;
  const hullTop = SHIP_AXLE_Z - SHIP_ARM;
  return [-0.25, 0.25].map(
    (x) =>
      [
        rotateShipPoint([x, 0, SHIP_AXLE_Z], swing),
        rotateShipPoint([x, 0, hullTop + 0.36], swing),
      ] as const,
  );
}

/** Swinging ship; `frame` 0..7 indexes `SHIP_SWING_DEGREES`, negative is the idle pose. */
export function swingingShip(frame: number): Mesh {
  const mesh: Mesh = [];
  mesh.push(...box([-0.48, -2.4, 0], [0.48, 2.4, 0.07], STONE));
  for (const x of [-0.44, 0.44]) {
    mesh.push(...beam([x, -1.45, 0.07], [x, 0, SHIP_AXLE_Z], 0.07, WHITE));
    mesh.push(...beam([x, 1.45, 0.07], [x, 0, SHIP_AXLE_Z], 0.07, WHITE));
    mesh.push(...box([x - 0.06, -1.58, 0.07], [x + 0.06, -1.32, 0.2], STEEL));
    mesh.push(...box([x - 0.06, 1.32, 0.07], [x + 0.06, 1.58, 0.2], STEEL));
  }
  mesh.push(...beam([-0.48, 0, SHIP_AXLE_Z], [0.48, 0, SHIP_AXLE_Z], 0.1, STEEL));
  mesh.push(...beam([-0.44, -1.45, 0.8], [-0.44, 1.45, 0.8], 0.06, STEEL));
  mesh.push(...beam([0.44, -1.45, 0.8], [0.44, 1.45, 0.8], 0.06, STEEL));
  for (const [pivot, attachment] of swingingShipArmEndpoints(frame))
    mesh.push(...beam(pivot, attachment, 0.07, STEEL));
  mesh.push(...swingingShipHull(frame));
  return mesh;
}

/** Seats of the ship's riders in operating frame `frame` (0..SHIP_SWING_DEGREES.length-1). */
export function swingingShipSeats(frame: number): Vec3[] {
  const swing = (SHIP_SWING_DEGREES[frame] * Math.PI) / 180;
  const hullTop = SHIP_AXLE_Z - SHIP_ARM;
  const out: Vec3[] = [];
  for (let i = 0; i < 6; i++)
    for (const x of [-0.2, 0.2]) {
      const y = -0.95 + i * 0.38;
      const z = hullTop + 0.2;
      out.push(rotateShipPoint([x, y, z], swing));
    }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ferris wheel, 1 x 4 (wheel in the y-z plane)

export const WHEEL_HUB_Z = 1.9;
export const WHEEL_RADIUS = 1.55;
const WHEEL_SPOKES = 12;

/** Ferris wheel; `frame` 0..7 turns it, negative is the idle pose (same as frame 0). */
export function ferrisWheel(frame: number): Mesh {
  const mesh: Mesh = [];
  const rotation = (Math.max(frame, 0) * Math.PI) / 16;
  mesh.push(...box([-0.48, -1.5, 0], [0.48, 1.5, 0.07], STONE));
  mesh.push(...box([-0.3, 1.0, 0.07], [0.3, 1.75, 0.16], PAVING));
  for (const x of [-0.36, 0.36]) {
    mesh.push(...beam([x, -1.25, 0.07], [x, 0, WHEEL_HUB_Z], 0.14, WHITE));
    mesh.push(...beam([x, 1.25, 0.07], [x, 0, WHEEL_HUB_Z], 0.14, WHITE));
    mesh.push(...beam([x, -0.6, 0.9], [x, 0.6, 0.9], 0.07, STEEL));
    mesh.push(...box([x - 0.1, -1.4, 0.07], [x + 0.1, -1.1, 0.14], STEEL));
    mesh.push(...box([x - 0.1, 1.1, 0.07], [x + 0.1, 1.4, 0.14], STEEL));
  }
  mesh.push(...beam([-0.4, 0, WHEEL_HUB_Z], [0.4, 0, WHEEL_HUB_Z], 0.12, STEEL));
  const rim = (a: number, x: number): Vec3 => [
    x,
    Math.cos(a) * WHEEL_RADIUS,
    WHEEL_HUB_Z + Math.sin(a) * WHEEL_RADIUS,
  ];
  const cabins = [RED, YELLOW, BLUE, ORANGE];
  const segments = WHEEL_SPOKES * 2;
  for (let i = 0; i < segments; i++) {
    const a0 = rotation + (i / segments) * TAU;
    const a1 = rotation + ((i + 1) / segments) * TAU;
    for (const x of [-0.2, 0.2]) mesh.push(...beam(rim(a0, x), rim(a1, x), 0.07, WHITE));
  }
  for (let i = 0; i < WHEEL_SPOKES; i++) {
    const a = rotation + (i / WHEEL_SPOKES) * TAU;
    for (const x of [-0.2, 0.2]) mesh.push(...beam([x, 0, WHEEL_HUB_Z], rim(a, x), 0.05, STEEL));
    const p = rim(a, 0);
    mesh.push(...beam([-0.2, p[1], p[2]], [0.2, p[1], p[2]], 0.05, STEEL));
    const g = mat('white');
    mesh.push(
      ...box(
        [-0.19, p[1] - 0.15, p[2] - 0.34],
        [0.19, p[1] + 0.15, p[2] - 0.1],
        cabins[i % cabins.length],
      ),
    );
    mesh.push(...box([-0.22, p[1] - 0.17, p[2] - 0.1], [0.22, p[1] + 0.17, p[2] - 0.05], g));
    mesh.push(...box([-0.15, p[1] - 0.11, p[2] - 0.3], [0.15, p[1] + 0.11, p[2] - 0.2], GLASS));
  }
  return mesh;
}

/** Seats of the Ferris wheel riders in operating frame `frame` (0..7). */
export function ferrisWheelSeats(frame: number): Vec3[] {
  const rotation = (frame * Math.PI) / 16;
  return Array.from({ length: WHEEL_SPOKES }, (_, i) => {
    const a = rotation + (i / WHEEL_SPOKES) * TAU;
    return [
      0,
      Math.cos(a) * WHEEL_RADIUS,
      WHEEL_HUB_Z + Math.sin(a) * WHEEL_RADIUS - 0.33 + 0.01,
    ] as Vec3;
  });
}

// ---------------------------------------------------------------------------------------------
// Twist, 3 x 3

const TWIST_ARM = 0.78;

function twistCar(cx: number, cy: number, z: number, colour: Material, spin: number): Mesh {
  const car: Mesh = [
    ...cylinder(cx, cy, z, z + 0.24, 0.25, 0.25, 10, colour, { capBottom: true }),
    ...cylinder(cx, cy, z + 0.24, z + 0.29, 0.27, 0.27, 10, WHITE),
    ...orientedBox(cx - 0.15, cy, z + 0.29, 0.06, 0.34, 0.22, 0, BLUE),
    ...cylinder(cx, cy, z + 0.12, z + 0.24, 0.18, 0.18, 8, GLASS),
  ];
  return rotateZ(car, spin, cx, cy);
}

/** Twist; arms and cars turn with `frame` 0..7, negative is the idle pose. */
export function twist(frame: number): Mesh {
  const mesh: Mesh = [];
  const f = Math.max(frame, 0);
  mesh.push(...cylinder(0, 0, 0, 0.1, 1.42, 1.42, 24, STONE, { capBottom: true }));
  mesh.push(...cylinder(0, 0, 0.1, 0.13, 1.3, 1.3, 24, PAVING, { capBottom: true }));
  mesh.push(...cylinder(0, 0, 0.13, 0.55, 0.3, 0.3, 12, STEEL));
  mesh.push(...cylinder(0, 0, 0.55, 0.64, 0.38, 0.38, 12, YELLOW));
  mesh.push(...stripedCone(0, 0, 0.64, 1.05, 0.34, 0.03, 8, YELLOW, ORANGE));
  const phase = (f * Math.PI) / 12;
  const colours = [RED, ORANGE, PINK, GREEN, PURPLE, YELLOW, BLUE, RED, ORANGE];
  for (let arm = 0; arm < 3; arm++) {
    const a = phase + (arm / 3) * TAU;
    const ax = Math.cos(a) * TWIST_ARM;
    const ay = Math.sin(a) * TWIST_ARM;
    mesh.push(...beam([0, 0, 0.55], [ax, ay, 0.5], 0.16, STEEL));
    mesh.push(...post(ax, ay, 0.1, 0.5, 0.08, STEEL));
    mesh.push(...cylinder(ax, ay, 0.5, 0.56, 0.6, 0.6, 12, ORANGE, { capBottom: true }));
    const spin = -f * (Math.PI / 5) + a;
    for (let k = 0; k < 3; k++) {
      const b = spin + (k / 3) * TAU;
      mesh.push(
        ...twistCar(
          ax + Math.cos(b) * 0.33,
          ay + Math.sin(b) * 0.33,
          0.56,
          colours[arm * 3 + k],
          b + Math.PI,
        ),
      );
    }
  }
  return mesh;
}

/** Seats of the Twist riders in operating frame `frame` (0..7). */
export function twistSeats(frame: number): Vec3[] {
  const phase = (frame * Math.PI) / 12;
  const out: Vec3[] = [];
  for (let arm = 0; arm < 3; arm++) {
    const a = phase + (arm / 3) * TAU;
    const spin = -frame * (Math.PI / 5) + a;
    for (let k = 0; k < 3; k++) {
      const b = spin + (k / 3) * TAU;
      out.push([
        Math.cos(a) * TWIST_ARM + Math.cos(b) * 0.33,
        Math.sin(a) * TWIST_ARM + Math.sin(b) * 0.33,
        0.56 + 0.22,
      ]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Haunted house, 3 x 3

/** Haunted house; operating frames 0..7 drift a ghost around the tower, negative is idle. */
export function hauntedHouse(frame: number): Mesh {
  const mesh: Mesh = [];
  const wall = mat('purple');
  const roof = mat('steel');
  const lit = (on: boolean): Material => (on ? YELLOW : GLASS);
  mesh.push(...box([-1.45, -1.45, 0], [1.45, 1.45, 0.06], PAVING));
  // main hall, gable toward +y
  mesh.push(...box([-1.3, -1.05, 0.06], [0.7, 1.05, 0.95], wall));
  mesh.push(...box([-1.34, -1.05, 0.06], [0.74, 1.09, 0.14], STONE));
  const ridge = 1.75;
  const eave = 0.95;
  mesh.push(
    ...quad(
      [
        [-1.42, -1.12, eave - 0.05],
        [-0.3, -1.12, ridge],
        [-0.3, 1.18, ridge],
        [-1.42, 1.18, eave - 0.05],
      ],
      roof,
    ),
    ...quad(
      [
        [0.82, -1.12, eave - 0.05],
        [-0.3, -1.12, ridge],
        [-0.3, 1.18, ridge],
        [0.82, 1.18, eave - 0.05],
      ],
      mat('stone'),
    ),
    ...polygon(
      [
        [-1.3, 1.05, eave],
        [0.7, 1.05, eave],
        [-0.3, 1.05, ridge - 0.07],
      ],
      wall,
    ),
    ...polygon(
      [
        [-1.3, -1.05, eave],
        [0.7, -1.05, eave],
        [-0.3, -1.05, ridge - 0.07],
      ],
      wall,
    ),
  );
  // porch and door
  mesh.push(...box([-0.4, 1.05, 0.06], [0.1, 1.4, 0.55], STONE));
  mesh.push(...box([-0.46, 1.0, 0.55], [0.16, 1.46, 0.62], roof));
  mesh.push(...box([-0.25, 1.4, 0.06], [-0.05, 1.43, 0.45], WOOD));
  mesh.push(...box([-0.45, 1.4, 0.06], [-0.4, 1.45, 0.55], WHITE));
  mesh.push(...box([0.05, 1.4, 0.06], [0.1, 1.45, 0.55], WHITE));
  for (let i = 0; i < 3; i++)
    mesh.push(...box([-0.4, 1.4 + i * 0.06, 0.06], [0.1, 1.46 + i * 0.06, 0.1 - i * 0.02], STONE));
  // windows
  const flicker = frame < 0 ? 0 : frame + 1;
  for (const [x, z] of [
    [-1.1, 0.4],
    [-0.8, 0.4],
    [0.3, 0.4],
    [-1.1, 0.7],
    [0.3, 0.7],
  ] as const) {
    const on = (flicker + Math.round((x + 2) * 3 + z * 5)) % 3 !== 0;
    mesh.push(...box([x - 0.08, 1.05, z - 0.1], [x + 0.08, 1.075, z + 0.1], lit(on)));
  }
  mesh.push(...box([-0.38, 1.05, 1.15], [-0.22, 1.08, 1.4], lit(flicker % 2 === 0)));
  for (const y of [-0.6, 0, 0.6]) {
    mesh.push(
      ...box(
        [0.7, y - 0.1, 0.4],
        [0.73, y + 0.1, 0.68],
        lit((flicker + Math.round(y * 5)) % 2 === 0),
      ),
    );
    mesh.push(
      ...box(
        [-1.33, y - 0.1, 0.4],
        [-1.3, y + 0.1, 0.68],
        lit((flicker + Math.round(y * 5)) % 3 === 0),
      ),
    );
  }
  // tower
  mesh.push(...box([0.55, -1.38, 0.06], [1.38, -0.55, 1.95], wall));
  mesh.push(...box([0.5, -1.43, 1.9], [1.43, -0.5, 2.0], roof));
  mesh.push(...stripedCone(0.965, -0.965, 2.0, 2.95, 0.78, 0.02, 8, roof, GLASS));
  mesh.push(...cylinder(0.965, -0.965, 2.95, 3.2, 0.02, 0.02, 4, WHITE));
  mesh.push(...box([0.7, -0.57, 1.1], [1.22, -0.54, 1.55], lit(flicker % 3 !== 0)));
  mesh.push(...box([0.52, -0.9, 1.1], [0.55, -0.55 - 0.05, 1.55], lit((flicker + 1) % 2 === 0)));
  // chimney, fence posts
  mesh.push(...box([0.0, -0.65, 1.2], [0.25, -0.4, 2.15], BRICK));
  for (let i = 0; i < 9; i++) {
    const x = -1.4 + i * 0.35;
    mesh.push(...box([x - 0.025, 1.38, 0.06], [x + 0.025, 1.42, 0.4 + (i % 2) * 0.08], STEEL));
  }
  for (const [x, h] of [
    [-1.15, 0.28],
    [-0.9, 0.2],
    [0.75, 0.25],
  ] as const) {
    mesh.push(...box([x - 0.08, 1.2, 0.06], [x + 0.08, 1.26, 0.06 + h], STONE));
    mesh.push(...box([x - 0.06, 1.2, 0.06 + h], [x + 0.06, 1.26, 0.1 + h], STONE));
  }
  mesh.push(...cylinder(-1.2, -1.15, 0.06, 0.95, 0.07, 0.04, 6, WOOD));
  mesh.push(...beam([-1.2, -1.15, 0.6], [-0.95, -1.0, 1.05], 0.04, WOOD));
  mesh.push(...beam([-1.2, -1.15, 0.7], [-1.4, -1.3, 1.1], 0.04, WOOD));
  mesh.push(...beam([-1.2, -1.15, 0.85], [-1.15, -0.95, 1.2], 0.035, WOOD));
  if (frame >= 0) {
    const a = (frame / 8) * TAU;
    const gx = 0.965 + Math.cos(a) * 0.62;
    const gy = -0.965 + Math.sin(a) * 0.62;
    const gz = 1.25 + 0.2 * Math.sin(a * 2);
    mesh.push(...cylinder(gx, gy, gz, gz + 0.3, 0.12, 0.04, 6, WHITE));
    mesh.push(...cylinder(gx, gy, gz + 0.3, gz + 0.42, 0.07, 0.07, 6, WHITE, { capBottom: true }));
  }
  return mapMesh(mesh, ([x, y, z]) => [x * 0.9, y * 0.9, z * 0.65]);
}

// ---------------------------------------------------------------------------------------------
// Top Spin, 3 x 3

export const TOPSPIN_AXLE_Z = 1.8;
const TOPSPIN_ARM = 1.05;

/** Top Spin; the arm turns by `frame` * 45 degrees (0..7), negative is the idle pose. */
export function topSpin(frame: number): Mesh {
  const mesh: Mesh = [];
  mesh.push(...box([-1.4, -1.35, 0], [1.4, 1.35, 0.07], STONE));
  mesh.push(...box([-1.2, -1.15, 0.07], [1.2, 1.15, 0.1], PAVING));
  for (const y of [-1.02, 1.02]) {
    mesh.push(...beam([-0.55, y, 0.1], [0, y, TOPSPIN_AXLE_Z], 0.17, RED));
    mesh.push(...beam([0.55, y, 0.1], [0, y, TOPSPIN_AXLE_Z], 0.17, RED));
    mesh.push(...beam([-0.4, y, 0.7], [0.4, y, 0.7], 0.08, STEEL));
    mesh.push(...box([-0.7, y - 0.14, 0.1], [-0.4, y + 0.14, 0.2], STEEL));
    mesh.push(...box([0.4, y - 0.14, 0.1], [0.7, y + 0.14, 0.2], STEEL));
  }
  mesh.push(...beam([0, -1.14, TOPSPIN_AXLE_Z], [0, 1.14, TOPSPIN_AXLE_Z], 0.13, STEEL));
  const angle = (Math.max(frame, 0) * Math.PI) / 4;
  const arm: Mesh = [
    ...beam([-TOPSPIN_ARM, 0, TOPSPIN_AXLE_Z], [TOPSPIN_ARM, 0, TOPSPIN_AXLE_Z], 0.14, STEEL, 0.36),
  ];
  for (const [side, colour] of [
    [-1, YELLOW],
    [1, ORANGE],
  ] as const) {
    const x = side * TOPSPIN_ARM;
    arm.push(
      ...box(
        [x - 0.24, -0.75, TOPSPIN_AXLE_Z - 0.16],
        [x + 0.24, 0.75, TOPSPIN_AXLE_Z + 0.16],
        colour,
      ),
      ...box(
        [x - 0.24, -0.78, TOPSPIN_AXLE_Z - 0.2],
        [x + 0.24, 0.78, TOPSPIN_AXLE_Z - 0.16],
        STEEL,
      ),
      ...box(
        [x + side * 0.2, -0.75, TOPSPIN_AXLE_Z - 0.16],
        [x + side * 0.26, 0.75, TOPSPIN_AXLE_Z + 0.34],
        BLUE,
      ),
    );
  }
  mesh.push(...rotateY(arm, angle, 0, TOPSPIN_AXLE_Z));
  return mesh;
}

/** Seats of the Top Spin riders in operating frame `frame` (0..7). */
export function topSpinSeats(frame: number): Vec3[] {
  const angle = (frame * Math.PI) / 4;
  const out: Vec3[] = [];
  for (const side of [-1, 1])
    for (let k = 0; k < 4; k++) {
      const dx = side * (TOPSPIN_ARM - 0.05);
      const y = -0.5 + k * 0.33;
      out.push([
        dx * Math.cos(angle),
        y,
        TOPSPIN_AXLE_Z - dx * Math.sin(angle) + 0.12 * Math.cos(angle),
      ]);
    }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Spiral slide, 2 x 2

const SLIDE_TOP = 2.15;
const SLIDE_BOTTOM = 0.22;
const SLIDE_TURNS = 2.4;
const SLIDE_RADIUS = 0.62;

/** Point on the slide's centre line, `t` from the top (0) to the bottom (1). */
export function slidePoint(t: number, radius = SLIDE_RADIUS): Vec3 {
  const a = t * SLIDE_TURNS * TAU + 0.6;
  return [Math.cos(a) * radius, Math.sin(a) * radius, SLIDE_TOP - t * (SLIDE_TOP - SLIDE_BOTTOM)];
}

/** Spiral slide; `frame` is unused by the geometry (riders move), negative is idle. */
export function spiralSlide(): Mesh {
  const mesh: Mesh = [];
  mesh.push(...box([-0.97, -0.97, 0], [0.97, 0.97, 0.06], mat('grass')));
  mesh.push(...cylinder(0, 0, 0.06, 0.12, 0.45, 0.45, 12, STONE, { capBottom: true }));
  mesh.push(...cylinder(0, 0, 0.12, SLIDE_TOP + 0.05, 0.27, 0.2, 12, WHITE));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.6;
    mesh.push(
      ...box(
        [Math.cos(a) * 0.24 - 0.04, Math.sin(a) * 0.24 - 0.04, 0.12],
        [Math.cos(a) * 0.24 + 0.04, Math.sin(a) * 0.24 + 0.04, SLIDE_TOP],
        RED,
      ),
    );
  }
  mesh.push(
    ...cylinder(0, 0, SLIDE_TOP + 0.05, SLIDE_TOP + 0.12, 0.52, 0.52, 12, YELLOW, {
      capBottom: true,
    }),
  );
  mesh.push(...stripedCone(0, 0, SLIDE_TOP + 0.12, SLIDE_TOP + 0.62, 0.5, 0.02, 8, RED, WHITE));
  const steps = 56;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const m = i % 2 === 0 ? YELLOW : ORANGE;
    mesh.push(...beam(slidePoint(t0), slidePoint(t1), 0.26, m, 0.04));
    mesh.push(
      ...beam(
        slidePoint(t0, SLIDE_RADIUS + 0.14),
        slidePoint(t1, SLIDE_RADIUS + 0.14),
        0.03,
        WHITE,
        0.14,
      ),
    );
    mesh.push(
      ...beam(
        slidePoint(t0, SLIDE_RADIUS - 0.14),
        slidePoint(t1, SLIDE_RADIUS - 0.14),
        0.03,
        WHITE,
        0.14,
      ),
    );
    if (i % 7 === 3) {
      const p = slidePoint(t0);
      mesh.push(...post(p[0], p[1], 0.06, p[2] - 0.02, 0.025, STEEL));
    }
  }
  const end = slidePoint(1);
  mesh.push(...box([end[0] - 0.2, end[1] - 0.2, 0.06], [end[0] + 0.2, end[1] + 0.2, 0.2], ORANGE));
  return mesh;
}

/** Positions of the two riders sliding down in operating frame `frame` (0..7). */
export function spiralSlideSeats(frame: number): Vec3[] {
  const t = (frame + 1) / 10;
  const a = slidePoint(t);
  const b = slidePoint(Math.max(0.04, t - 0.42));
  return [
    [a[0], a[1], a[2] + 0.04],
    [b[0], b[1], b[2] + 0.04],
  ];
}

// ---------------------------------------------------------------------------------------------
// Enterprise, 4 x 4

export const ENTERPRISE_HUB_Z = 1.3;
const ENTERPRISE_RADIUS = 1.62;
const ENTERPRISE_TILT = (40 * Math.PI) / 180;
const ENTERPRISE_CARS = 12;

function enterpriseRim(a: number): Vec3 {
  const c = Math.cos(ENTERPRISE_TILT);
  const s = Math.sin(ENTERPRISE_TILT);
  const x = Math.cos(a) * ENTERPRISE_RADIUS;
  const z = Math.sin(a) * ENTERPRISE_RADIUS;
  return [x, -z * s, ENTERPRISE_HUB_Z + z * c];
}

/** Enterprise; the tilted wheel turns by `frame` * pi/16 (0..7), negative is the idle pose. */
export function enterprise(frame: number): Mesh {
  const mesh: Mesh = [];
  const spin = (Math.max(frame, 0) * Math.PI) / 16;
  mesh.push(...cylinder(0, 0, 0, 0.08, 1.9, 1.9, 24, STONE, { capBottom: true }));
  mesh.push(...cylinder(0, 0, 0.08, 0.11, 1.7, 1.7, 24, PAVING, { capBottom: true }));
  mesh.push(...cylinder(0, 0, 0.11, 0.3, 0.55, 0.45, 12, PURPLE));
  mesh.push(...cylinder(0, 0, 0.3, ENTERPRISE_HUB_Z, 0.16, 0.1, 10, STEEL));
  mesh.push(...beam([0.0, 0.35, 0.2], [0, 0, ENTERPRISE_HUB_Z], 0.1, STEEL));
  mesh.push(
    ...cylinder(0, 0, ENTERPRISE_HUB_Z - 0.06, ENTERPRISE_HUB_Z + 0.1, 0.2, 0.2, 10, YELLOW),
  );
  const hub: Vec3 = [0, 0, ENTERPRISE_HUB_Z];
  const colours = [RED, BLUE, YELLOW, GREEN];
  const segments = ENTERPRISE_CARS * 2;
  for (let i = 0; i < segments; i++) {
    const a0 = spin + (i / segments) * TAU;
    const a1 = spin + ((i + 1) / segments) * TAU;
    mesh.push(...beam(enterpriseRim(a0), enterpriseRim(a1), 0.08, WHITE));
  }
  for (let i = 0; i < ENTERPRISE_CARS; i++) {
    const a = spin + (i / ENTERPRISE_CARS) * TAU;
    const p = enterpriseRim(a);
    mesh.push(...beam(hub, p, 0.05, STEEL));
    mesh.push(
      ...box(
        [p[0] - 0.19, p[1] - 0.19, p[2] - 0.12],
        [p[0] + 0.19, p[1] + 0.19, p[2] + 0.14],
        colours[i % colours.length],
      ),
      ...box(
        [p[0] - 0.21, p[1] - 0.21, p[2] + 0.14],
        [p[0] + 0.21, p[1] + 0.21, p[2] + 0.19],
        WHITE,
      ),
    );
  }
  return mesh;
}

/** Seats of the Enterprise riders in operating frame `frame` (0..7). */
export function enterpriseSeats(frame: number): Vec3[] {
  const spin = (frame * Math.PI) / 16;
  return Array.from({ length: ENTERPRISE_CARS }, (_, i) => {
    const p = enterpriseRim(spin + (i / ENTERPRISE_CARS) * TAU);
    return [p[0], p[1], p[2] + 0.02] as Vec3;
  });
}

// ---------------------------------------------------------------------------------------------
// Observation tower, 1 x 1

export const TOWER_CABIN_Z = [0.5, 0.9, 1.4, 2.0, 2.5, 2.2, 1.6, 1.0] as const;

/** Observation tower; the cabin climbs with `frame` 0..7, negative is the idle pose (at rest). */
export function observationTower(frame: number): Mesh {
  const mesh: Mesh = [];
  const cabinZ = frame < 0 ? 0.3 : TOWER_CABIN_Z[frame];
  mesh.push(...cylinder(0, 0, 0, 0.07, 0.43, 0.43, 14, STONE, { capBottom: true }));
  mesh.push(...cylinder(0, 0, 0.07, 0.4, 0.2, 0.15, 12, WHITE));
  mesh.push(...cylinder(0, 0, 0.4, 3.45, 0.11, 0.09, 12, WHITE));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    mesh.push(
      ...box(
        [Math.cos(a) * 0.11 - 0.015, Math.sin(a) * 0.11 - 0.015, 0.4],
        [Math.cos(a) * 0.11 + 0.015, Math.sin(a) * 0.11 + 0.015, 3.4],
        RED,
      ),
    );
  }
  mesh.push(...cylinder(0, 0, 3.4, 3.5, 0.34, 0.34, 12, STEEL, { capBottom: true }));
  mesh.push(...cylinder(0, 0, 3.5, 3.78, 0.34, 0.34, 12, GLASS));
  mesh.push(...cylinder(0, 0, 3.78, 3.86, 0.36, 0.36, 12, YELLOW));
  mesh.push(...stripedCone(0, 0, 3.86, 4.15, 0.34, 0.02, 12, RED, WHITE));
  mesh.push(...cylinder(0, 0, 4.15, 4.4, 0.02, 0.012, 4, STEEL));
  mesh.push(...cylinder(0, 0, cabinZ, cabinZ + 0.05, 0.3, 0.3, 12, STEEL, { capBottom: true }));
  mesh.push(...cylinder(0, 0, cabinZ + 0.05, cabinZ + 0.3, 0.29, 0.29, 12, GLASS));
  mesh.push(...cylinder(0, 0, cabinZ + 0.3, cabinZ + 0.36, 0.31, 0.31, 12, YELLOW));
  return mesh;
}

/** Riders in the cabin in operating frame `frame` (0..7). */
export function observationTowerSeats(frame: number): Vec3[] {
  const cabinZ = TOWER_CABIN_Z[frame];
  return Array.from({ length: 4 }, (_, i) => {
    const a = (i / 4) * TAU + (frame * Math.PI) / 8;
    return [Math.cos(a) * 0.2, Math.sin(a) * 0.2, cabinZ + 0.06] as Vec3;
  });
}
