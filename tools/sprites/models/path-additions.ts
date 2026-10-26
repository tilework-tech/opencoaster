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
 *
 * Sizes are fractions of a guest (0.373 tall in these units): a bench is about 0.6 of a guest
 * with its backrest and spans half the tile edge, a bin about 0.45, a lamp about 1.4. The
 * vandalised variants reach the same height as the intact ones.
 */
const BENCH_HALF_LENGTH = 0.24;
const BENCH_SEAT_Z = 0.11;
const BENCH_TOP_Z = 0.22;

function benchFrame(y: number): Mesh {
  return [
    ...box([-0.05, y - 0.012, 0], [0.05, y + 0.012, BENCH_SEAT_Z], WOOD),
    ...box([0.035, y - 0.012, BENCH_SEAT_Z], [0.06, y + 0.012, BENCH_TOP_Z - 0.01], WOOD),
  ];
}

export function benchMesh(): Mesh {
  return [
    ...benchFrame(-BENCH_HALF_LENGTH + 0.03),
    ...benchFrame(BENCH_HALF_LENGTH - 0.03),
    ...box(
      [-0.06, -BENCH_HALF_LENGTH, BENCH_SEAT_Z],
      [-0.005, BENCH_HALF_LENGTH, BENCH_SEAT_Z + 0.022],
      WOOD,
    ),
    ...box(
      [0.0, -BENCH_HALF_LENGTH, BENCH_SEAT_Z],
      [0.05, BENCH_HALF_LENGTH, BENCH_SEAT_Z + 0.022],
      WOOD,
    ),
    ...box([0.045, -BENCH_HALF_LENGTH, 0.15], [0.07, BENCH_HALF_LENGTH, 0.18], TIMBER),
    ...box([0.045, -BENCH_HALF_LENGTH, 0.19], [0.07, BENCH_HALF_LENGTH, BENCH_TOP_Z], TIMBER),
  ];
}

export function brokenBenchMesh(): Mesh {
  return [
    ...benchFrame(-BENCH_HALF_LENGTH + 0.03),
    ...benchFrame(BENCH_HALF_LENGTH - 0.03),
    ...box(
      [0.0, -BENCH_HALF_LENGTH, BENCH_SEAT_Z],
      [0.05, BENCH_HALF_LENGTH, BENCH_SEAT_Z + 0.022],
      TIMBER,
    ),
    ...box([-0.06, -BENCH_HALF_LENGTH, BENCH_SEAT_Z], [-0.005, 0.03, BENCH_SEAT_Z + 0.022], TIMBER),
    ...box([-0.1, 0.07, 0], [-0.045, 0.17, 0.022], TIMBER),
    ...box([0.045, -BENCH_HALF_LENGTH, 0.15], [0.07, BENCH_HALF_LENGTH, 0.18], TIMBER),
    ...box([0.045, -BENCH_HALF_LENGTH, 0.19], [0.07, -0.02, BENCH_TOP_Z], TIMBER),
  ];
}

const BIN_TOP_Z = 0.17;

export function binMesh(): Mesh {
  return [
    ...box([-0.05, -0.05, 0], [0.05, 0.05, 0.145], GREEN),
    ...box([-0.06, -0.06, 0.145], [0.06, 0.06, 0.16], STEEL),
    ...box([-0.04, -0.04, 0.16], [0.01, 0.04, 0.165], GLASS),
    ...box([0.02, -0.05, 0.16], [0.055, 0.05, BIN_TOP_Z], STEEL),
  ];
}

export function brokenBinMesh(): Mesh {
  return [
    ...box([-0.05, -0.05, 0], [0.05, 0.05, 0.145], GREEN),
    ...box([-0.06, -0.06, 0.145], [0.06, 0.0, 0.16], STEEL),
    ...box([0.02, -0.05, 0.16], [0.055, 0.0, BIN_TOP_Z], STEEL),
    ...box([-0.04, 0.0, 0.145], [0.04, 0.04, 0.15], GLASS),
    ...box([-0.14, 0.01, 0], [-0.07, 0.08, 0.02], STEEL),
  ];
}

const LAMP_TOP_Z = 0.52;

export function lampMesh(): Mesh {
  return [
    ...cylinder(0, 0, 0, 0.03, 0.035, 0.035, 8, STEEL, { capTop: false }),
    ...cylinder(0, 0, 0.03, 0.43, 0.016, 0.016, 8, STEEL),
    ...box([-0.04, -0.04, 0.43], [0.04, 0.04, 0.45], STEEL),
    ...box([-0.032, -0.032, 0.45], [0.032, 0.032, 0.5], YELLOW),
    ...box([-0.045, -0.045, 0.5], [0.045, 0.045, LAMP_TOP_Z], RED),
  ];
}

export function brokenLampMesh(): Mesh {
  return [
    ...cylinder(0, 0, 0, 0.03, 0.035, 0.035, 8, STEEL, { capTop: false }),
    ...cylinder(0, 0, 0.03, 0.43, 0.016, 0.016, 8, STEEL),
    ...box([-0.04, -0.04, 0.43], [0.04, 0.04, 0.45], STEEL),
    ...box([-0.032, -0.032, 0.45], [0.032, 0.032, 0.5], GLASS),
    ...box([-0.045, -0.045, 0.5], [0.0, 0.045, LAMP_TOP_Z], RED),
  ];
}
