import { beam, box, cylinder, material, orientedBox, quad } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';
import { ellipseHeading, ellipsePoint } from './ride-model';
import type { RideModel } from './ride-model';

const mat = (name: string) => material(ramp(name));
const ASPHALT = mat('asphalt');
const GRASS = mat('grass');
const WHITE = mat('white');
const RED = mat('red');
const BLUE = mat('blue');
const YELLOW = mat('yellow');
const STEEL = mat('steel');
const SKIN = mat('skin');
const GLASS = mat('glass');
const TIRE = mat('steel');

const RX = 0.34;
const RY = 0.24;
const HALF = 0.07;
const SEGMENTS = 32;
const SURFACE_Z = 0.025;

/** Asphalt loop with alternating red and white kerbs on both edges and a low barrier outside. */
function circuit(): Mesh {
  const mesh: Mesh = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const a0 = (i / SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
    const lane = (sign: number, a: number, z: number) =>
      ellipsePoint(RX + sign * HALF, RY + sign * HALF, a, z);
    mesh.push(
      ...quad(
        [
          lane(-1, a0, SURFACE_Z),
          lane(-1, a1, SURFACE_Z),
          lane(1, a1, SURFACE_Z),
          lane(1, a0, SURFACE_Z),
        ],
        ASPHALT,
      ),
    );
    const kerb = i % 2 === 0 ? RED : WHITE;
    for (const sign of [1, -1]) {
      mesh.push(
        ...beam(lane(sign, a0, SURFACE_Z + 0.01), lane(sign, a1, SURFACE_Z + 0.01), 0.025, kerb),
      );
    }
    const barrier = i % 2 === 0 ? BLUE : YELLOW;
    const outer = (a: number, z: number) => ellipsePoint(RX + HALF + 0.03, RY + HALF + 0.03, a, z);
    mesh.push(
      ...quad([outer(a0, 0.02), outer(a1, 0.02), outer(a1, 0.08), outer(a0, 0.08)], barrier),
    );
  }
  return mesh;
}

/** Kart with a dark seat, a steering wheel, a driver's head, and four wheels. */
function kart(angle: number, colour: ReturnType<typeof mat>): Mesh {
  const [cx, cy] = ellipsePoint(RX, RY, angle);
  const heading = ellipseHeading(RX, RY, angle);
  const z = SURFACE_Z;
  const mesh: Mesh = [];
  mesh.push(...orientedBox(cx, cy, z + 0.01, 0.14, 0.085, 0.03, heading, colour));
  mesh.push(...orientedBox(cx, cy, z + 0.04, 0.07, 0.07, 0.03, heading, WHITE));
  mesh.push(...orientedBox(cx - 0.02, cy, z + 0.07, 0.05, 0.06, 0.04, heading, GLASS));
  mesh.push(...orientedBox(cx - 0.02, cy, z + 0.11, 0.04, 0.04, 0.04, heading, SKIN));
  const fwd = [Math.cos(heading), Math.sin(heading)];
  const side = [-fwd[1], fwd[0]];
  for (const f of [-0.05, 0.05]) {
    for (const s of [-0.05, 0.05]) {
      const x = cx + fwd[0] * f + side[0] * s;
      const y = cy + fwd[1] * f + side[1] * s;
      mesh.push(...cylinder(x, y, z, z + 0.03, 0.025, 0.025, 6, TIRE, { capBottom: true }));
    }
  }
  mesh.push(...beam([cx, cy, z + 0.02], [cx, cy, z + 0.04], 0.01, STEEL));
  return mesh;
}

/** Three karts circling the loop, nose-to-tail, with a pit-lane gantry at the start. */
function goKarts(frame: number): Mesh {
  const mesh: Mesh = [];
  mesh.push(...box([-0.46, -0.46, 0], [0.46, 0.46, 0.03], GRASS));
  mesh.push(...circuit());
  const colours = [RED, BLUE, YELLOW];
  for (let k = 0; k < 3; k++) {
    mesh.push(...kart((k / 3 + frame / 12) * Math.PI * 2, colours[k]));
  }
  mesh.push(...box([0.2, -0.36, 0.03], [0.22, -0.3, 0.22], STEEL));
  mesh.push(...box([0.2, -0.36, 0.2], [0.3, -0.3, 0.22], RED));
  return mesh;
}

export const GO_KARTS_MODEL: RideModel = {
  key: 'rides/go-karts',
  frames: 4,
  build: goKarts,
};
