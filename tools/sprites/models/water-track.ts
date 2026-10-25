import { box, beam, material, orientedBox, quad } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';

const WATER = material(ramp('blue'));
const FOAM = material(ramp('foam'));
const STONE = material(ramp('stone'));
const WOOD = material(ramp('wood'));
const TIMBER = material(ramp('timber'));
const RED = material(ramp('red'));
const SKIN = material(ramp('skin'));

export const WATER_RIDE_FAMILIES = ['log-flume', 'river-rapids'] as const;
export const WATER_CAR_PITCHES = [
  'down90',
  'down60',
  'down25',
  'flat',
  'up25',
  'up60',
  'up90',
] as const;

export function waterTrackMesh(splash = false): Mesh {
  const mesh: Mesh = [];
  mesh.push(
    ...quad(
      [
        [-0.5, -0.12, 0.08],
        [0.5, -0.12, 0.08],
        [0.5, 0.12, 0.08],
        [-0.5, 0.12, 0.08],
      ],
      WATER,
    ),
  );
  for (const side of [-1, 1]) {
    const y = side * 0.16;
    mesh.push(...beam([-0.5, y, 0.04], [0.5, y, 0.04], 0.05, STONE, 0.09));
    mesh.push(...beam([-0.5, side * 0.12, 0.1], [0.5, side * 0.12, 0.1], 0.025, WOOD, 0.025));
  }
  if (splash)
    for (let i = 0; i < 5; i++) {
      const x = -0.16 + i * 0.08;
      mesh.push(...box([x, -0.04, 0.1], [x + 0.03, 0.04, 0.23 + (i % 2) * 0.05], FOAM));
    }
  return mesh;
}

export function waterCarMesh(family: string, heading: number, pitch: number): Mesh {
  const mesh: Mesh = [];
  const angle = (heading * Math.PI) / 4;
  if (family === 'log-flume') {
    mesh.push(...orientedBox(0, 0, 0.1, 0.24, 0.11, 0.055, angle, TIMBER));
    mesh.push(...orientedBox(0, 0, 0.15, 0.21, 0.085, 0.025, angle, WOOD));
    for (const along of [-0.055, 0.055]) {
      const x = Math.cos(angle) * along;
      const y = Math.sin(angle) * along;
      mesh.push(...box([x - 0.025, y - 0.025, 0.18], [x + 0.025, y + 0.025, 0.26], SKIN));
      mesh.push(...box([x - 0.03, y - 0.035, 0.14], [x + 0.03, y + 0.035, 0.2], RED));
    }
  } else {
    mesh.push(...orientedBox(0, 0, 0.1, 0.19, 0.19, 0.045, angle, STONE));
    mesh.push(...orientedBox(0, 0, 0.15, 0.16, 0.16, 0.035, angle, FOAM));
    for (let i = 0; i < 3; i++) {
      const a = angle + i * ((Math.PI * 2) / 3);
      const x = Math.cos(a) * 0.07;
      const y = Math.sin(a) * 0.07;
      mesh.push(...box([x - 0.022, y - 0.022, 0.19], [x + 0.022, y + 0.022, 0.27], SKIN));
    }
  }
  return mesh.map((triangle) => ({
    material: triangle.material,
    v: triangle.v.map(([x, y, z]) => [
      x,
      y,
      z + (x * Math.cos(angle) + y * Math.sin(angle)) * pitch * 0.08,
    ]) as typeof triangle.v,
  }));
}
