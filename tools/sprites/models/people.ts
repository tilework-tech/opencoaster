import { box, cylinder, material, physicalToLevels, rotateZ } from '../mesh';
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
  const stride = [0.035, 0.012, -0.035, -0.012][frame & 3]!;
  const swing = [0.028, 0.01, -0.028, -0.01][frame & 3]!;
  const garment = material(ramp(clothes));
  const leg = material(ramp(staff ? 'asphalt' : 'steel'));
  const shoe = material(ramp('wood'));
  const mesh: Mesh = [
    ...cylinder(0, 0, 0.12, 0.29, 0.031, 0.042, 6, garment, { phase: Math.PI / 6 }),
    ...cylinder(0, 0, 0.29, 0.37, 0.034, 0.034, 8, SKIN),
    ...cylinder(0, 0, 0.36, 0.388, 0.035, 0.035, 8, HAIR),
    ...box([-0.018 + stride, -0.025, 0.025], [0.005 + stride, 0.002, 0.125], leg),
    ...box([-0.005 - stride, 0.002, 0.025], [0.018 - stride, 0.025, 0.125], leg),
    ...box([-0.024 + stride, -0.032, 0.015], [0.009 + stride, 0.005, 0.04], shoe),
    ...box([-0.009 - stride, 0.005, 0.015], [0.024 - stride, 0.032, 0.04], shoe),
    ...box([0.027, -0.039, 0.17 - swing], [0.043, -0.02, 0.26 - swing], garment),
    ...box([-0.043, 0.02, 0.17 + swing], [-0.027, 0.039, 0.26 + swing], garment),
  ];
  if (staff) {
    mesh.push(...box([-0.04, -0.04, 0.375], [0.04, 0.04, 0.387], material(ramp('white'))));
  }
  return mesh;
}

/** Compact low-poly people with four walking poses, oriented to a cardinal world direction. */
export function personMesh(kind: number, direction: number, frame: number, staff = false): Mesh {
  const clothes = staff ? STAFF_CLOTHES[kind % STAFF_CLOTHES.length] : GUEST_CLOTHES[kind % 8];
  return rotateZ(
    physicalToLevels(walker(clothes, frame & 3, staff)),
    ((direction & 3) * Math.PI) / 2,
  );
}

/** Guest sitting in a ride vehicle: torso, head and arms forward on a lap bar, no legs. */
function seated(clothes: string): Mesh {
  const garment = material(ramp(clothes));
  return [
    ...cylinder(0, 0, 0.0, 0.17, 0.034, 0.04, 6, garment, { phase: Math.PI / 6 }),
    ...cylinder(0, 0, 0.17, 0.25, 0.034, 0.034, 8, SKIN),
    ...cylinder(0, 0, 0.245, 0.272, 0.035, 0.035, 8, HAIR),
    ...box([0.03, -0.045, 0.07], [0.075, -0.025, 0.12], garment),
    ...box([0.03, 0.025, 0.07], [0.075, 0.045, 0.12], garment),
  ];
}

/** Small seated rider facing a cardinal world direction, tinted like the guest palette. */
export function seatedRiderMesh(kind: number, direction: number): Mesh {
  return rotateZ(
    physicalToLevels(seated(GUEST_CLOTHES[kind % 8])),
    ((direction & 3) * Math.PI) / 2,
  );
}
