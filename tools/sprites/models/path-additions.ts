import { box, cylinder, material, quad } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';

const WOOD = material(ramp('wood'));
const TIMBER = material(ramp('timber'));
const RED = material(ramp('red'));
const YELLOW = material(ramp('yellow'));
const STEEL = material(ramp('steel'));
const GREEN = material(ramp('green'));
const GLASS = material(ramp('glass'));

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

/**
 * Path additions are authored for the edge of tile (0, 0) facing +x: the open path edge is toward
 * +x, so a bench puts its backrest on +x and its seat faces -x, into the path. Each view rotates
 * the model about the vertical axis, so every rotation is the same object turned.
 */
const BENCH_HALF_LENGTH = 0.2;
const BENCH_SEAT_Z = 0.2;

function benchFrame(y: number): Mesh {
  return [
    ...box([-0.09, y - 0.02, 0], [0.09, y + 0.02, BENCH_SEAT_Z], WOOD),
    ...box([0.06, y - 0.02, BENCH_SEAT_Z], [0.1, y + 0.02, 0.46], WOOD),
  ];
}

export function benchMesh(): Mesh {
  return [
    ...benchFrame(-BENCH_HALF_LENGTH + 0.03),
    ...benchFrame(BENCH_HALF_LENGTH - 0.03),
    ...box(
      [-0.1, -BENCH_HALF_LENGTH, BENCH_SEAT_Z],
      [-0.01, BENCH_HALF_LENGTH, BENCH_SEAT_Z + 0.04],
      WOOD,
    ),
    ...box(
      [0.0, -BENCH_HALF_LENGTH, BENCH_SEAT_Z],
      [0.09, BENCH_HALF_LENGTH, BENCH_SEAT_Z + 0.04],
      WOOD,
    ),
    ...box([0.08, -BENCH_HALF_LENGTH, 0.28], [0.12, BENCH_HALF_LENGTH, 0.35], TIMBER),
    ...box([0.08, -BENCH_HALF_LENGTH, 0.38], [0.12, BENCH_HALF_LENGTH, 0.45], TIMBER),
  ];
}

export function brokenBenchMesh(): Mesh {
  return [
    ...benchFrame(-BENCH_HALF_LENGTH + 0.03),
    ...benchFrame(BENCH_HALF_LENGTH - 0.03),
    ...box(
      [0.0, -BENCH_HALF_LENGTH, BENCH_SEAT_Z],
      [0.09, BENCH_HALF_LENGTH, BENCH_SEAT_Z + 0.04],
      TIMBER,
    ),
    ...box([-0.1, -BENCH_HALF_LENGTH, BENCH_SEAT_Z], [-0.01, 0.04, BENCH_SEAT_Z + 0.04], TIMBER),
    ...box([-0.17, 0.09, 0], [-0.08, 0.23, 0.04], TIMBER),
    ...box([0.08, -BENCH_HALF_LENGTH, 0.28], [0.12, BENCH_HALF_LENGTH, 0.35], TIMBER),
    ...box([0.08, -BENCH_HALF_LENGTH, 0.38], [0.12, -0.02, 0.45], TIMBER),
  ];
}

export function binMesh(): Mesh {
  return [
    ...box([-0.1, -0.1, 0], [0.1, 0.1, 0.34], GREEN),
    ...box([-0.115, -0.115, 0.34], [0.115, 0.115, 0.39], STEEL),
    ...box([-0.07, -0.07, 0.39], [0.02, 0.07, 0.4], GLASS),
    ...box([0.03, -0.09, 0.39], [0.09, 0.09, 0.44], STEEL),
  ];
}

export function brokenBinMesh(): Mesh {
  return [
    ...box([-0.1, -0.1, 0], [0.1, 0.1, 0.3], GREEN),
    ...box([-0.07, -0.07, 0.3], [0.07, 0.07, 0.31], GLASS),
    ...box([-0.25, -0.02, 0], [-0.13, 0.12, 0.04], STEEL),
  ];
}

export function lampMesh(): Mesh {
  return [
    ...cylinder(0, 0, 0, 0.06, 0.06, 0.05, 8, STEEL, { capTop: false }),
    ...cylinder(0, 0, 0.06, 0.72, 0.03, 0.03, 8, STEEL),
    ...box([-0.08, -0.08, 0.72], [0.08, 0.08, 0.76], STEEL),
    ...box([-0.065, -0.065, 0.76], [0.065, 0.065, 0.88], YELLOW),
    ...box([-0.09, -0.09, 0.88], [0.09, 0.09, 0.92], RED),
  ];
}

export function brokenLampMesh(): Mesh {
  return [
    ...cylinder(0, 0, 0, 0.06, 0.06, 0.05, 8, STEEL, { capTop: false }),
    ...cylinder(0, 0, 0.06, 0.58, 0.03, 0.03, 8, STEEL),
    ...box([-0.08, -0.08, 0.58], [0.08, 0.08, 0.62], STEEL),
    ...box([-0.065, -0.065, 0.62], [0.065, 0.065, 0.74], GLASS),
    ...box([-0.075, -0.075, 0.74], [0.0, 0.075, 0.78], RED),
  ];
}
