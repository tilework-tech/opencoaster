import { beam, box, material, quad } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';

const STONE = material(ramp('stone'));
const BRICK = material(ramp('brick'));
const WOOD = material(ramp('wood'));
const TIMBER = material(ramp('timber'));
const RED = material(ramp('red'));
const YELLOW = material(ramp('yellow'));
const WHITE = material(ramp('white'));
const GREEN = material(ramp('green'));

export function parkEntranceMesh(frame: number): Mesh {
  const roof = frame % 2 === 0 ? RED : BRICK;
  return [
    ...box([-0.47, -0.18, 0], [-0.29, 0.18, 0.77], STONE),
    ...box([0.29, -0.18, 0], [0.47, 0.18, 0.77], STONE),
    ...box([-0.4, -0.15, 0.07], [-0.32, 0.2, 0.68], BRICK),
    ...box([0.32, -0.15, 0.07], [0.4, 0.2, 0.68], BRICK),
    ...beam([-0.38, 0, 0.71], [0.38, 0, 0.71], 0.16, WOOD),
    ...quad(
      [
        [-0.52, -0.26, 0.77],
        [0.52, -0.26, 0.77],
        [0.4, 0.24, 0.66],
        [-0.4, 0.24, 0.66],
      ],
      roof,
    ),
    ...box([-0.23, 0.21, 0.5], [0.23, 0.25, 0.65], YELLOW),
    ...box([-0.15, 0.25, 0.54], [0.15, 0.26, 0.61], WHITE),
    ...box([-0.16, 0.18, 0.06], [-0.03, 0.22, 0.35], GREEN),
    ...box([0.03, 0.18, 0.06], [0.16, 0.22, 0.35], GREEN),
    ...box([-0.44, 0.18, 0.11], [-0.27, 0.23, 0.37], TIMBER),
    ...box([0.27, 0.18, 0.11], [0.44, 0.23, 0.37], TIMBER),
  ];
}
