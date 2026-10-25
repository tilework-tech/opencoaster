import { box, cylinder, material } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';

const PAPER = material(ramp('white'));
const RED = material(ramp('red'));
const GREEN = material(ramp('green'));
const YELLOW = material(ramp('yellow'));

export function trashMesh(): Mesh {
  return [
    ...cylinder(0, 0, 0, 0.14, 0.15, 0.18, 8, RED, { capBottom: true }),
    ...box([-0.16, -0.08, 0.12], [-0.02, 0.13, 0.16], PAPER),
    ...box([0.05, -0.13, 0.11], [0.17, 0.05, 0.15], YELLOW),
  ];
}

export function vomitMesh(): Mesh {
  return [
    ...cylinder(0, 0, 0, 0.035, 0.28, 0.18, 12, GREEN, { capBottom: true }),
    ...cylinder(-0.16, 0.02, 0, 0.025, 0.13, 0.11, 8, GREEN, { capBottom: true }),
    ...cylinder(0.17, -0.04, 0, 0.03, 0.12, 0.1, 8, GREEN, { capBottom: true }),
  ];
}
