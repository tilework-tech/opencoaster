import { box, material, quad } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';

const WOOD = material(ramp('wood'));
const TIMBER = material(ramp('timber'));
const RED = material(ramp('red'));
const YELLOW = material(ramp('yellow'));
const STEEL = material(ramp('steel'));
const GREEN = material(ramp('green'));

export function shelterMesh(): Mesh {
  return [
    ...box([-0.39, -0.38, 0], [-0.34, -0.33, 1.05], WOOD),
    ...box([0.34, -0.38, 0], [0.39, -0.33, 1.05], WOOD),
    ...box([-0.39, 0.33, 0], [-0.34, 0.38, 1.05], WOOD),
    ...box([0.34, 0.33, 0], [0.39, 0.38, 1.05], WOOD),
    ...box([-0.32, -0.27, 0.37], [0.32, 0.27, 0.43], TIMBER),
    ...box([-0.32, 0.22, 0.43], [0.32, 0.28, 0.68], TIMBER),
    ...quad(
      [
        [-0.51, -0.48, 0.93],
        [0.51, -0.48, 0.93],
        [0.42, 0, 1.34],
        [-0.42, 0, 1.34],
      ],
      RED,
    ),
    ...quad(
      [
        [-0.51, 0.48, 0.93],
        [0.51, 0.48, 0.93],
        [0.42, 0, 1.34],
        [-0.42, 0, 1.34],
      ],
      YELLOW,
    ),
    ...box([-0.52, -0.49, 0.88], [0.52, -0.45, 0.95], TIMBER),
    ...box([-0.52, 0.45, 0.88], [0.52, 0.49, 0.95], TIMBER),
  ];
}

export function brokenBenchMesh(): Mesh {
  return [
    ...box([-0.42, -0.24, 0.45], [0.42, -0.15, 0.53], TIMBER),
    ...box([-0.34, 0.01, 0.45], [0.04, 0.1, 0.53], WOOD),
    ...box([0.19, 0.01, 0.45], [0.36, 0.1, 0.53], WOOD),
    ...box([-0.31, -0.2, 0], [-0.24, -0.12, 0.43], WOOD),
    ...box([0.23, -0.2, 0], [0.3, -0.12, 0.43], WOOD),
    ...box([-0.3, 0.03, 0], [-0.23, 0.11, 0.42], WOOD),
    ...box([0.24, 0.03, 0], [0.31, 0.11, 0.42], WOOD),
  ];
}

export function brokenBinMesh(): Mesh {
  return [
    ...box([-0.26, -0.23, 0], [0.24, 0.23, 0.54], GREEN),
    ...box([-0.31, -0.24, 0.48], [0.25, -0.18, 0.55], STEEL),
    ...box([-0.28, 0.18, 0.48], [0.29, 0.24, 0.55], STEEL),
    ...box([-0.27, -0.17, 0.5], [-0.19, 0.17, 0.58], STEEL),
    ...box([0.19, -0.16, 0.5], [0.28, 0.18, 0.57], STEEL),
    ...box([-0.31, -0.07, 0.54], [-0.25, 0.07, 0.61], STEEL),
  ];
}

export function brokenLampMesh(): Mesh {
  return [
    ...box([-0.035, -0.035, 0], [0.035, 0.035, 0.56], STEEL),
    ...box([-0.02, -0.02, 0.53], [0.07, 0.07, 0.68], WOOD),
    ...box([0.04, 0.04, 0.64], [0.12, 0.12, 0.79], STEEL),
    ...box([0.06, 0.07, 0.75], [0.32, 0.13, 0.8], STEEL),
    ...box([0.25, 0.06, 0.63], [0.38, 0.15, 0.78], YELLOW),
    ...box([0.29, 0.07, 0.76], [0.35, 0.13, 0.82], RED),
    ...box([0.36, 0.06, 0.65], [0.4, 0.15, 0.71], STEEL),
  ];
}
