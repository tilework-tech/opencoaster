import { box, cylinder, material, quad } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';
import { ellipsePoint } from './ride-model';
import type { RideModel } from './ride-model';

const mat = (name: string) => material(ramp(name));
const STONE = mat('stone');
const WATER = mat('blue');
const FOAM = mat('foam');
const GRASS = mat('grass');
const WHITE = mat('white');
const RED = mat('red');
const ORANGE = mat('orange');
const YELLOW = mat('yellow');
const SKIN = mat('skin');

const CHANNEL_RADIUS = 0.36;
const CHANNEL_HALF = 0.1;
const ISLAND_RADIUS = 0.15;
const SEGMENTS = 32;
const WATER_Z = 0.06;

/** Circular rapids channel around a stone island, with foam bands that drift with the frame. */
function channel(frame: number): Mesh {
  const mesh: Mesh = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const a0 = (i / SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
    const ring = (r: number, a: number, z: number) => ellipsePoint(r, r, a, z);
    const foam = (i + frame * 3) % 6 < 2;
    mesh.push(
      ...quad(
        [
          ring(CHANNEL_RADIUS - CHANNEL_HALF, a0, WATER_Z),
          ring(CHANNEL_RADIUS - CHANNEL_HALF, a1, WATER_Z),
          ring(CHANNEL_RADIUS + CHANNEL_HALF, a1, WATER_Z),
          ring(CHANNEL_RADIUS + CHANNEL_HALF, a0, WATER_Z),
        ],
        foam ? FOAM : WATER,
      ),
    );
    for (const r of [CHANNEL_RADIUS - CHANNEL_HALF, CHANNEL_RADIUS + CHANNEL_HALF]) {
      mesh.push(
        ...quad(
          [ring(r, a0, 0.02), ring(r, a1, 0.02), ring(r, a1, 0.1), ring(r, a0, 0.1)],
          i % 2 === 0 ? STONE : GRASS,
        ),
      );
    }
  }
  mesh.push(
    ...cylinder(0, 0, 0.02, 0.12, ISLAND_RADIUS, ISLAND_RADIUS - 0.02, 16, STONE, { capTop: true }),
  );
  return mesh;
}

/** Round raft: white rim, a red-and-yellow seat, and a marker that shows its spin. */
function raft(angle: number, spin: number): Mesh {
  const [x, y] = ellipsePoint(CHANNEL_RADIUS, CHANNEL_RADIUS, angle);
  const z = WATER_Z;
  const mesh: Mesh = [];
  mesh.push(...cylinder(x, y, z, z + 0.04, 0.085, 0.08, 12, WHITE, { capBottom: true }));
  mesh.push(...cylinder(x, y, z + 0.04, z + 0.05, 0.07, 0.07, 12, ORANGE));
  mesh.push(...cylinder(x, y, z + 0.05, z + 0.11, 0.035, 0.03, 8, RED));
  for (let k = 0; k < 2; k++) {
    const a = spin + k * Math.PI;
    const px = x + Math.cos(a) * 0.05;
    const py = y + Math.sin(a) * 0.05;
    mesh.push(...box([px - 0.02, py - 0.02, z + 0.11], [px + 0.02, py + 0.02, z + 0.17], SKIN));
  }
  const mx = x + Math.cos(spin) * 0.075;
  const my = y + Math.sin(spin) * 0.075;
  mesh.push(...box([mx - 0.012, my - 0.012, z + 0.04], [mx + 0.012, my + 0.012, z + 0.1], YELLOW));
  return mesh;
}

/** Three rafts circle the channel; each spins on its own axis as it goes round. */
function riverRapids(frame: number): Mesh {
  const mesh: Mesh = [];
  mesh.push(...box([-0.46, -0.46, 0], [0.46, 0.46, 0.03], GRASS));
  mesh.push(...channel(frame));
  for (let k = 0; k < 3; k++) {
    const angle = (k / 3 + frame / 12) * Math.PI * 2;
    mesh.push(...raft(angle, (frame * Math.PI) / 2 + k));
  }
  return mesh;
}

export const RIVER_RAPIDS_MODEL: RideModel = {
  key: 'rides/river-rapids',
  frames: 4,
  build: riverRapids,
};
