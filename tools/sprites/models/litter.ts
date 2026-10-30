import { box, cylinder, material } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';

const PAPER = material(ramp('white'));
const RED = material(ramp('red'));
const GREEN = material(ramp('green'));
const YELLOW = material(ramp('yellow'));

export function trashMesh(): Mesh {
  return [
    ...cylinder(0, 0, 0, 0.04, 0.035, 0.025, 8, RED, { capBottom: true }),
    ...box([-0.04, -0.025, 0.025], [-0.008, 0.03, 0.035], PAPER),
    ...box([0.01, -0.035, 0.025], [0.04, 0.025, 0.035], YELLOW),
  ];
}

export function vomitMesh(): Mesh {
  return [
    ...cylinder(0, 0, 0, 0.015, 0.05, 0.02, 12, GREEN, { capBottom: true }),
    ...cylinder(-0.035, 0.006, 0, 0.012, 0.025, 0.015, 8, GREEN, { capBottom: true }),
    ...cylinder(0.035, -0.012, 0, 0.012, 0.025, 0.015, 8, GREEN, { capBottom: true }),
  ];
}

export function canMesh(): Mesh {
  return [
    ...cylinder(0, 0, 0, 0.05, 0.03, 0.03, 8, material(ramp('steel')), { capBottom: true }),
    ...cylinder(0, 0, 0.05, 0.055, 0.022, 0.022, 8, RED),
  ];
}

export function burgerBoxMesh(): Mesh {
  return [
    ...box([-0.05, -0.04, 0], [0.05, 0.04, 0.035], PAPER),
    ...box([-0.05, -0.04, 0.035], [0.05, -0.01, 0.045], YELLOW),
    ...box([-0.04, 0.0, 0.035], [0.03, 0.035, 0.04], RED),
  ];
}
