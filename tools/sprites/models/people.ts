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

/** Top of the seat planks of the path bench, in the units of `path-additions.ts`. */
const BENCH_SEAT_TOP = 0.134;

/**
 * Guest sitting on a path bench, facing +x like the walkers: back toward -x against the bench's
 * backrest, thighs along the seat, shins hanging past its front edge to the ground and hands on
 * the knees. The origin is the middle of the seat, so the sprite is placed on a seat position.
 */
function sitter(clothes: string): Mesh {
  const garment = material(ramp(clothes));
  const trousers = material(ramp('steel'));
  const shoe = material(ramp('wood'));
  const top = BENCH_SEAT_TOP;
  return [
    ...cylinder(0, 0, top, top + 0.13, 0.031, 0.04, 6, garment, { phase: Math.PI / 6 }),
    ...cylinder(0, 0, top + 0.13, top + 0.205, 0.034, 0.034, 8, SKIN),
    ...cylinder(0, 0, top + 0.2, top + 0.228, 0.035, 0.035, 8, HAIR),
    ...box([-0.02, -0.03, top], [0.085, -0.004, top + 0.03], trousers),
    ...box([-0.02, 0.004, top], [0.085, 0.03, top + 0.03], trousers),
    ...box([0.06, -0.03, 0.02], [0.087, -0.004, top + 0.03], trousers),
    ...box([0.06, 0.004, 0.02], [0.087, 0.03, top + 0.03], trousers),
    ...box([0.058, -0.032, 0], [0.105, -0.002, 0.02], shoe),
    ...box([0.058, 0.002, 0], [0.105, 0.032, 0.02], shoe),
    ...box([-0.012, -0.048, top + 0.03], [0.012, -0.032, top + 0.115], garment),
    ...box([-0.012, 0.032, top + 0.03], [0.012, 0.048, top + 0.115], garment),
    ...box([-0.012, -0.048, top + 0.03], [0.07, -0.032, top + 0.05], garment),
    ...box([-0.012, 0.032, top + 0.03], [0.07, 0.048, top + 0.05], garment),
  ];
}

/** Guest sitting on a bench, facing a cardinal world direction, tinted like the guest palette. */
export function benchSitterMesh(kind: number, direction: number): Mesh {
  return rotateZ(
    physicalToLevels(sitter(GUEST_CLOTHES[kind % 8])),
    ((direction & 3) * Math.PI) / 2,
  );
}
