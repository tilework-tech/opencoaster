import { beam, box, cylinder, material, orientedBox, quad } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';
import { ellipseHeading, ellipsePoint } from './ride-model';
import type { RideModel } from './ride-model';

const mat = (name: string) => material(ramp(name));
const STONE = mat('stone');
const WATER = mat('blue');
const FOAM = mat('foam');
const TIMBER = mat('timber');
const WOOD = mat('wood');
const ORANGE = mat('orange');
const WHITE = mat('white');
const GRASS = mat('grass');
const SKIN = mat('skin');
const RED = mat('red');

const RX = 0.34;
const RY = 0.25;
/** Half-width of the water channel around the centre line. */
const CHANNEL = 0.08;
const SEGMENTS = 32;
const WALL_TOP = 0.13;
const WATER_Z = 0.07;

/** Trough: stone walls either side of an elliptical water channel. */
function trough(frame: number): Mesh {
  const mesh: Mesh = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const a0 = (i / SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
    const ripple = (i + frame * 2) % 4 === 0 ? FOAM : WATER;
    const lane = (sign: number, a: number, z: number) =>
      ellipsePoint(RX + sign * CHANNEL, RY + sign * CHANNEL, a, z);
    mesh.push(
      ...quad(
        [lane(-1, a0, WATER_Z), lane(-1, a1, WATER_Z), lane(1, a1, WATER_Z), lane(1, a0, WATER_Z)],
        ripple,
      ),
    );
    for (const sign of [1, -1]) {
      const wall = i % 2 === 0 ? STONE : WHITE;
      mesh.push(
        ...quad(
          [
            lane(sign, a0, 0.02),
            lane(sign, a1, 0.02),
            lane(sign, a1, WALL_TOP),
            lane(sign, a0, WALL_TOP),
          ],
          wall,
        ),
      );
      mesh.push(...beam(lane(sign, a0, WALL_TOP), lane(sign, a1, WALL_TOP), 0.04, WOOD, 0.03));
    }
  }
  return mesh;
}

/** Log boat with two riders, placed on the channel at parameter `t` (turns) and turned to the tangent. */
function logBoat(t: number, riderSkin: number): Mesh {
  const angle = t * Math.PI * 2;
  const centre = ellipsePoint(RX, RY, angle, WATER_Z);
  const heading = ellipseHeading(RX, RY, angle);
  const mesh: Mesh = [];
  mesh.push(...orientedBox(centre[0], centre[1], WATER_Z, 0.2, 0.1, 0.05, heading, TIMBER));
  mesh.push(...orientedBox(centre[0], centre[1], WATER_Z + 0.05, 0.19, 0.08, 0.02, heading, WOOD));
  mesh.push(
    ...orientedBox(centre[0], centre[1], WATER_Z + 0.02, 0.05, 0.11, 0.05, heading, ORANGE),
  );
  for (const along of [-0.04, 0.05]) {
    const x = centre[0] + Math.cos(heading) * along;
    const y = centre[1] + Math.sin(heading) * along;
    mesh.push(
      ...box(
        [x - 0.025, y - 0.025, WATER_Z + 0.07],
        [x + 0.025, y + 0.025, WATER_Z + 0.12],
        riderSkin === 0 ? RED : WHITE,
      ),
    );
    mesh.push(
      ...box([x - 0.02, y - 0.02, WATER_Z + 0.12], [x + 0.02, y + 0.02, WATER_Z + 0.17], SKIN),
    );
  }
  return mesh;
}

/** Splash burst where the boat drops off the lift, animated over the four frames. */
function splash(frame: number): Mesh {
  const mesh: Mesh = [];
  const base = ellipsePoint(RX, RY, -Math.PI / 4, WATER_Z);
  const height = [0.08, 0.14, 0.1, 0.05][frame % 4];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + frame * 0.7;
    const r = 0.035 + (k % 2) * 0.02;
    const x = base[0] + Math.cos(a) * r;
    const y = base[1] + Math.sin(a) * r;
    mesh.push(
      ...cylinder(x, y, WATER_Z, WATER_Z + height * (k % 2 ? 0.7 : 1), 0.02, 0.008, 5, FOAM),
    );
  }
  return mesh;
}

/** Flume with two log boats circling the channel, one rider pair each, and a splash at the drop. */
function logFlume(frame: number): Mesh {
  const mesh: Mesh = [];
  mesh.push(...box([-0.46, -0.46, 0], [0.46, 0.46, 0.03], GRASS));
  mesh.push(...trough(frame));
  const progress = frame / 4;
  mesh.push(...logBoat(progress, 0));
  mesh.push(...logBoat(progress + 0.5, 1));
  mesh.push(...splash(frame));
  return mesh;
}

export const LOG_FLUME_MODEL: RideModel = {
  key: 'rides/log-flume',
  frames: 4,
  build: logFlume,
};
