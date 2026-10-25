import { box, cylinder, material, quad } from '../../mesh';
import type { Material, Mesh } from '../../mesh';
import { ramp } from '../../palette';

export type FacilityModel = {
  key: string;
  frames: number;
  build: (frame: number) => Mesh;
};

export const facilityMaterials = {
  wood: material(ramp('wood')),
  timber: material(ramp('timber')),
  red: material(ramp('red')),
  orange: material(ramp('orange')),
  yellow: material(ramp('yellow')),
  green: material(ramp('green')),
  blue: material(ramp('blue')),
  purple: material(ramp('purple')),
  white: material(ramp('white')),
  stone: material(ramp('stone')),
  brick: material(ramp('brick')),
  steel: material(ramp('steel')),
  glass: material(ramp('glass')),
};

export function signPlaque(color: Material, frame: number, x0 = -0.22, x1 = 0.22): Mesh {
  const glow = frame % 4 === 0 ? facilityMaterials.yellow : facilityMaterials.white;
  return [
    ...box([x0, 0.285, 0.38], [x1, 0.32, 0.51], color),
    ...box([x0 + 0.035, 0.32, 0.405], [x0 + 0.075, 0.33, 0.485], glow),
    ...box([x0 + 0.1, 0.32, 0.405], [x0 + 0.14, 0.33, 0.485], facilityMaterials.white),
  ];
}

export function counterBooth(wall: Material, roof: Material, frame: number): Mesh {
  const mesh: Mesh = [
    ...box([-0.34, -0.3, 0], [0.34, 0.3, 0.38], wall),
    ...box([-0.38, -0.34, 0.38], [0.38, 0.34, 0.43], roof),
    ...box([-0.36, 0.21, 0.17], [0.36, 0.34, 0.2], facilityMaterials.wood),
    ...box([-0.09, 0.295, 0.02], [0.09, 0.32, 0.17], facilityMaterials.wood),
    ...signPlaque(roof, frame),
  ];
  return mesh;
}

export function stripedCanopy(first: Material, second: Material, frame: number, z = 0.44): Mesh {
  const mesh: Mesh = [];
  for (let i = 0; i < 8; i++) {
    const x0 = -0.39 + (i / 8) * 0.78;
    const x1 = -0.39 + ((i + 1) / 8) * 0.78;
    const trim = i === frame % 8 ? facilityMaterials.yellow : i % 2 === 0 ? first : second;
    mesh.push(
      ...quad(
        [
          [x0, -0.3, z],
          [x1, -0.3, z],
          [x1, 0.32, z - 0.1],
          [x0, 0.32, z - 0.1],
        ],
        trim,
      ),
      ...box([x0, 0.31, z - 0.14], [x1, 0.34, z - 0.08], trim),
    );
  }
  return mesh;
}

export function toppedDrum(body: Material, top: Material): Mesh {
  return [
    ...cylinder(0, 0, 0, 0.05, 0.27, 0.27, 12, facilityMaterials.steel, { capBottom: true }),
    ...cylinder(0, 0, 0.05, 0.42, 0.29, 0.29, 12, body),
    ...cylinder(0, 0, 0.42, 0.46, 0.3, 0.3, 12, facilityMaterials.white),
    ...cylinder(0, 0, 0.46, 0.49, 0.28, 0.28, 12, top),
    ...box([-0.17, 0.27, 0.18], [0.17, 0.32, 0.3], facilityMaterials.steel),
  ];
}
