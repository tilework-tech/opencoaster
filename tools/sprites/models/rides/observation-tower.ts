import { beam, box, cylinder, material } from '../../mesh';
import type { Mesh } from '../../mesh';
import { ramp } from '../../palette';
import { rider } from './common';
import type { RideModel } from '../rides';

const WHITE = material(ramp('white'));
const RED = material(ramp('red'));
const STEEL = material(ramp('steel'));
const GLASS = material(ramp('glass'));
const YELLOW = material(ramp('yellow'));
const CABIN_HEIGHTS = [0.12, 0.2, 0.31, 0.43, 0.53, 0.43, 0.31, 0.2] as const;

function observationTower(frame: number, occupied: boolean): Mesh {
  const mesh: Mesh = [];
  const cabinZ = CABIN_HEIGHTS[frame];
  mesh.push(...cylinder(0, 0, 0, 0.05, 0.4, 0.4, 12, STEEL, { capBottom: true }));
  for (const x of [-0.14, 0.14])
    for (const y of [-0.14, 0.14]) {
      mesh.push(...beam([x, y, 0.05], [x * 0.62, y * 0.62, 1.44], 0.035, WHITE));
      mesh.push(...beam([x * 0.62, y * 0.62, 1.44], [x, y, 0.05], 0.018, RED));
    }
  mesh.push(...cylinder(0, 0, 1.42, 1.5, 0.19, 0.19, 8, STEEL));
  mesh.push(...stripedRoof());
  mesh.push(...box([-0.2, -0.2, cabinZ], [0.2, 0.2, cabinZ + 0.045], STEEL));
  mesh.push(...box([-0.18, -0.18, cabinZ + 0.045], [0.18, 0.18, cabinZ + 0.2], GLASS));
  mesh.push(...box([-0.22, -0.22, cabinZ + 0.2], [0.22, 0.22, cabinZ + 0.24], YELLOW));
  mesh.push(...box([-0.06, -0.06, cabinZ + 0.24], [0.06, 0.06, cabinZ + 0.29], WHITE));
  if (occupied)
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + (frame * Math.PI) / 8;
      mesh.push(...rider(Math.cos(angle) * 0.1, Math.sin(angle) * 0.1, cabinZ + 0.16));
    }
  return mesh;
}

function stripedRoof(): Mesh {
  const mesh: Mesh = [];
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2;
    const a1 = ((i + 1) / 8) * Math.PI * 2;
    mesh.push(
      ...beam(
        [Math.cos(a0) * 0.2, Math.sin(a0) * 0.2, 1.5],
        [Math.cos(a1) * 0.2, Math.sin(a1) * 0.2, 1.5],
        0.04,
        i % 2 === 0 ? RED : WHITE,
      ),
    );
  }
  mesh.push(...cylinder(0, 0, 1.5, 1.7, 0.2, 0.02, 8, RED));
  return mesh;
}

export const model: RideModel = {
  key: 'rides/observation-tower',
  frames: 9,
  build(frame) {
    if (frame === 0) return observationTower(0, false);
    return observationTower(frame - 1, true);
  },
};
