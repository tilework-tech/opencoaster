import { box, material, physicalToLevels, rotateZ } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';

const SKIN = material(ramp('skin'));
const HAIR = material(ramp('wood'));
const GUEST_CLOTHES = [
  'red',
  'yellow',
  'green',
  'blue',
  'purple',
  'white',
  'orange',
  'blue',
] as const;
const STAFF_CLOTHES = ['green', 'blue', 'purple', 'orange'] as const;

function walker(clothes: string, frame: number, staff: boolean): Mesh {
  const stride = frame === 0 ? 0.035 : -0.035;
  const garment = material(ramp(clothes));
  const leg = material(ramp(staff ? 'asphalt' : 'steel'));
  const mesh: Mesh = [
    ...box([-0.055, -0.045, 0.12], [0.055, 0.045, 0.255], garment),
    ...box([-0.04, -0.04, 0.255], [0.04, 0.04, 0.335], SKIN),
    ...box([-0.045, -0.04, 0.32], [0.045, 0.04, 0.35], HAIR),
    ...box([-0.025 + stride, -0.035, 0.015], [0.015 + stride, 0.005, 0.125], leg),
    ...box([-0.015 - stride, 0.005, 0.015], [0.025 - stride, 0.035, 0.125], leg),
    ...box([0.035, -0.065, 0.14 - stride / 3], [0.07, -0.035, 0.235 - stride / 3], garment),
    ...box([-0.07, 0.035, 0.14 + stride / 3], [-0.035, 0.065, 0.235 + stride / 3], garment),
  ];
  if (staff) {
    mesh.push(...box([-0.055, -0.052, 0.34], [0.055, 0.052, 0.365], material(ramp('white'))));
  }
  return mesh;
}

/** Original low-poly people in walking poses, oriented to a cardinal world direction. */
export function personMesh(kind: number, direction: number, frame: number, staff = false): Mesh {
  const clothes = staff ? STAFF_CLOTHES[kind % STAFF_CLOTHES.length] : GUEST_CLOTHES[kind % 8];
  return rotateZ(
    physicalToLevels(walker(clothes, frame & 1, staff)),
    ((direction & 3) * Math.PI) / 2,
  );
}
