import { beam, box, material } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';

const WOOD = material(ramp('wood'));
const TIMBER = material(ramp('timber'));
const STONE = material(ramp('stone'));
const LEAF = material(ramp('green'));

function edgeEnds(
  edge: number,
  slopeMask: number,
): [[number, number, number], [number, number, number]] {
  const heights = [0, 1, 2, 3].map((corner) => (slopeMask >> corner) & 1);
  switch (edge & 3) {
    case 0:
      return [
        [0.46, -0.5, heights[1]!],
        [0.46, 0.5, heights[2]!],
      ];
    case 1:
      return [
        [-0.5, 0.46, heights[3]!],
        [0.5, 0.46, heights[2]!],
      ];
    case 2:
      return [
        [-0.46, -0.5, heights[0]!],
        [-0.46, 0.5, heights[3]!],
      ];
    default:
      return [
        [-0.5, -0.46, heights[0]!],
        [0.5, -0.46, heights[1]!],
      ];
  }
}

export function wallMesh(
  style: 'hedge' | 'wooden-fence' | 'stone-fence',
  edge: number,
  slopeMask: number,
): Mesh {
  const [a, b] = edgeEnds(edge, slopeMask);
  if (style === 'hedge') {
    const mesh: Mesh = [];
    const steps = 8;
    for (let step = 0; step < steps; step++) {
      const t0 = step / steps;
      const t1 = (step + 1) / steps;
      const p0: [number, number, number] = [
        a[0] + (b[0] - a[0]) * t0,
        a[1] + (b[1] - a[1]) * t0,
        a[2] + (b[2] - a[2]) * t0,
      ];
      const p1: [number, number, number] = [
        a[0] + (b[0] - a[0]) * t1,
        a[1] + (b[1] - a[1]) * t1,
        a[2] + (b[2] - a[2]) * t1,
      ];
      const pad = 0.07;
      const minX = Math.min(p0[0], p1[0]) - (edge % 2 ? 0 : pad);
      const maxX = Math.max(p0[0], p1[0]) + (edge % 2 ? 0 : pad);
      const minY = Math.min(p0[1], p1[1]) - (edge % 2 ? pad : 0);
      const maxY = Math.max(p0[1], p1[1]) + (edge % 2 ? pad : 0);
      mesh.push(
        ...box(
          [minX, minY, Math.min(p0[2], p1[2])],
          [maxX, maxY, Math.max(p0[2], p1[2]) + 0.75],
          LEAF,
        ),
      );
    }
    return mesh;
  }
  const wood = style === 'wooden-fence' ? WOOD : STONE;
  const rail = style === 'wooden-fence' ? TIMBER : STONE;
  const [ax, ay, az] = a;
  const [bx, by, bz] = b;
  const post = (x: number, y: number, z: number): Mesh =>
    box([x - 0.04, y - 0.04, z], [x + 0.04, y + 0.04, z + 0.74], wood);
  return [
    ...post(ax, ay, az),
    ...post((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2),
    ...post(bx, by, bz),
    ...beam([ax, ay, az + 0.28], [bx, by, bz + 0.28], 0.045, rail),
    ...beam([ax, ay, az + 0.63], [bx, by, bz + 0.63], 0.045, rail),
  ];
}
