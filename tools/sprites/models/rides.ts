import { beam, box, cylinder, material, orientedBox, physicalToLevels, quad } from '../mesh';
import type { Material, Mesh } from '../mesh';
import { ramp } from '../palette';
import {
  enterprise,
  ferrisWheel,
  hauntedHouse,
  merryGoRound,
  observationTower,
  spiralSlide,
  swingingShip,
  topSpin,
  twist,
} from './flat-rides';

const mat = (name: string): Material => material(ramp(name));
const WHITE = mat('white');
const RED = mat('red');
const BLUE = mat('blue');
const YELLOW = mat('yellow');
const GREEN = mat('green');
const ORANGE = mat('orange');
const PURPLE = mat('purple');
const WOOD = mat('wood');
const GLASS = mat('glass');
const BRICK = mat('brick');

export interface RideModel {
  /** Manifest key without view suffix, e.g. `rides/merry-go-round`. */
  key: string;
  frames: number;
  /** Mesh for operating frame `frame`, authored in physical tile units around the tile centre. */
  build: (frame: number) => Mesh;
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

function goKarts(frame: number): Mesh {
  const mesh: Mesh = [];
  const ring = (rx: number, ry: number, a: number): [number, number] => [
    Math.cos(a) * rx,
    Math.sin(a) * ry,
  ];
  mesh.push(...cylinder(0, 0, 0, 0.02, 0.48, 0.48, 16, mat('grass'), { capBottom: true }));
  const segments = 24;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const o0 = ring(0.44, 0.34, a0);
    const o1 = ring(0.44, 0.34, a1);
    const i0 = ring(0.26, 0.16, a0);
    const i1 = ring(0.26, 0.16, a1);
    mesh.push(
      ...quad(
        [
          [o0[0], o0[1], 0.025],
          [o1[0], o1[1], 0.025],
          [i1[0], i1[1], 0.025],
          [i0[0], i0[1], 0.025],
        ],
        mat('asphalt'),
      ),
    );
    const k = i % 2 === 0 ? RED : WHITE;
    mesh.push(...beam([o0[0], o0[1], 0.04], [o1[0], o1[1], 0.04], 0.025, k));
    mesh.push(...beam([i0[0], i0[1], 0.04], [i1[0], i1[1], 0.04], 0.025, k));
  }
  const colors = [RED, BLUE, YELLOW];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3 + frame / 12) * Math.PI * 2;
    const p = ring(0.35, 0.25, a);
    const dx = -Math.sin(a) * 0.35;
    const dy = Math.cos(a) * 0.25;
    const heading = Math.atan2(dy, dx);
    mesh.push(...orientedBox(p[0], p[1], 0.025, 0.1, 0.06, 0.04, heading, colors[k]));
    mesh.push(...orientedBox(p[0], p[1], 0.065, 0.03, 0.04, 0.04, heading, WHITE));
  }
  return mesh;
}

function logFlume(frame: number): Mesh {
  const mesh: Mesh = [];
  mesh.push(...box([-0.46, -0.46, 0], [0.46, 0.46, 0.03], mat('grass')));
  const path: Array<[number, number, number]> = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    path.push([
      -0.38 + t * 0.76,
      Math.sin(t * Math.PI * 2) * 0.22,
      0.04 + Math.max(0, 0.3 * (1 - Math.abs(t * 2 - 0.6) / 0.6)) * (t < 0.6 ? 1 : 0),
    ]);
  }
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    mesh.push(...beam([a[0], a[1], a[2]], [b[0], b[1], b[2]], 0.2, mat('blue'), 0.04));
    mesh.push(
      ...beam([a[0], a[1] - 0.1, a[2] + 0.04], [b[0], b[1] - 0.1, b[2] + 0.04], 0.03, WOOD, 0.06),
    );
    mesh.push(
      ...beam([a[0], a[1] + 0.1, a[2] + 0.04], [b[0], b[1] + 0.1, b[2] + 0.04], 0.03, WOOD, 0.06),
    );
    if (a[2] > 0.06) mesh.push(...beam([a[0], a[1], 0], [a[0], a[1], a[2]], 0.03, WOOD));
  }
  for (let k = 0; k < 2; k++) {
    const idx = Math.min(15, Math.floor(((frame + k * 2) % 4) * 4 + k * 2));
    const p = path[idx];
    mesh.push(
      ...box(
        [p[0] - 0.07, p[1] - 0.045, p[2] + 0.04],
        [p[0] + 0.07, p[1] + 0.045, p[2] + 0.1],
        k === 0 ? mat('timber') : ORANGE,
      ),
    );
  }
  return mesh;
}

function riverRapids(frame: number): Mesh {
  const mesh: Mesh = [];
  mesh.push(...cylinder(0, 0, 0, 0.04, 0.47, 0.47, 16, mat('stone'), { capBottom: true }));
  mesh.push(...cylinder(0, 0, 0.04, 0.05, 0.4, 0.4, 16, mat('blue')));
  mesh.push(...cylinder(0, 0, 0.04, 0.1, 0.17, 0.2, 10, mat('stone')));
  mesh.push(...cylinder(0, 0, 0.04, 0.06, 0.18, 0.18, 12, mat('grass')));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3 + frame / 12) * Math.PI * 2;
    const x = Math.cos(a) * 0.3;
    const y = Math.sin(a) * 0.3;
    mesh.push(
      ...cylinder(x, y, 0.05, 0.12, 0.08, 0.08, 8, k === 1 ? YELLOW : ORANGE, { capBottom: true }),
    );
    mesh.push(...cylinder(x, y, 0.12, 0.125, 0.05, 0.05, 8, WHITE));
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
const BURGER: StallStyle = {
  walls: mat('timber'),
  awning: [ORANGE, YELLOW],
  roof: mat('wood'),
  sign: RED,
};
const TOILETS: StallStyle = {
  walls: mat('stone'),
  awning: [GLASS, GLASS],
  roof: BRICK,
  sign: BLUE,
};

export const RIDE_MODELS: readonly RideModel[] = [
  { key: 'rides/merry-go-round', frames: 9, build: merryGoRound },
  { key: 'rides/swinging-ship', frames: 9, build: swingingShip },
  { key: 'rides/ferris-wheel', frames: 9, build: ferrisWheel },
  { key: 'rides/twist', frames: 9, build: twist },
  { key: 'rides/food-stall', frames: 4, build: (f) => stall(FOOD, f, 'food') },
  { key: 'rides/drink-stall', frames: 4, build: (f) => stall(DRINK, f, 'drink') },
  { key: 'rides/information-kiosk', frames: 4, build: (f) => stall(INFO, f, 'info') },
  { key: 'rides/haunted-house', frames: 9, build: hauntedHouse },
  { key: 'rides/spiral-slide', frames: 9, build: spiralSlide },
  { key: 'rides/top-spin', frames: 9, build: topSpin },
  { key: 'rides/enterprise', frames: 9, build: enterprise },
  { key: 'rides/go-karts', frames: 4, build: goKarts },
  { key: 'rides/log-flume', frames: 4, build: logFlume },
  { key: 'rides/river-rapids', frames: 4, build: riverRapids },
  { key: 'rides/observation-tower', frames: 9, build: observationTower },
  { key: 'rides/burger-stall', frames: 4, build: (f) => stall(BURGER, f, 'food') },
  { key: 'rides/toilets', frames: 4, build: (f) => stall(TOILETS, f, 'toilets') },
];

/** The ride mesh in height levels, ready for `renderMesh`. */
export function rideMesh(model: RideModel, frame: number): Mesh {
  return physicalToLevels(model.build(frame));
}
