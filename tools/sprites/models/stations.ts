import { beam, box, material, quad } from '../mesh';
import type { Mesh } from '../mesh';
import { RIDE_CATALOG } from '../../../src/sim/rides/ride-types';
import type { RideCategory } from '../../../src/sim/rides/ride-types';
import { ramp } from '../palette';

const STEEL = material(ramp('steel'));
const WOOD = material(ramp('wood'));
const TIMBER = material(ramp('timber'));
const BRICK = material(ramp('brick'));
const WHITE = material(ramp('white'));
const RED = material(ramp('red'));
const ORANGE = material(ramp('orange'));
const YELLOW = material(ramp('yellow'));
const BLUE = material(ramp('blue'));
const GREEN = material(ramp('green'));
const PURPLE = material(ramp('purple'));
const WATER = material(ramp('glass'));

const CATEGORY_STYLE: Record<string, { post: typeof WOOD; roof: typeof RED; sign: typeof BLUE }> = {
  gentle: { post: WHITE, roof: RED, sign: YELLOW },
  thrill: { post: STEEL, roof: ORANGE, sign: PURPLE },
  coaster: { post: TIMBER, roof: WOOD, sign: YELLOW },
  transport: { post: STEEL, roof: BLUE, sign: WHITE },
  water: { post: WHITE, roof: BLUE, sign: WATER },
};

export const STATION_CATEGORIES = Array.from(
  new Set(
    Object.values(RIDE_CATALOG)
      .map((ride) => ride.category)
      .filter((category) => !['shop', 'stall', 'facility'].includes(category)),
  ),
) as RideCategory[];

export function stationHutMesh(category: RideCategory, part: 'entrance' | 'exit'): Mesh {
  const style = CATEGORY_STYLE[category] ?? CATEGORY_STYLE.gentle;
  const mesh: Mesh = [
    ...box([-0.35, 0.23, 0], [-0.27, 0.33, 0.58], style.post),
    ...box([0.27, 0.23, 0], [0.35, 0.33, 0.58], style.post),
    ...beam([-0.38, 0.28, 0.55], [0.38, 0.28, 0.55], 0.11, style.roof),
    ...box([-0.21, 0.26, 0.32], [0.21, 0.34, 0.48], part === 'entrance' ? BRICK : GREEN),
    ...box([-0.14, 0.34, 0.02], [0.14, 0.36, 0.31], STEEL),
    ...box([-0.28, 0.32, 0.39], [0.28, 0.36, 0.52], style.sign),
    ...box([-0.2, 0.36, 0.43], [-0.06, 0.37, 0.47], WHITE),
    ...box([-0.02, 0.36, 0.43], [0.2, 0.37, 0.47], part === 'entrance' ? YELLOW : WHITE),
    ...quad(
      [
        [-0.4, 0.18, 0.6],
        [0.4, 0.18, 0.6],
        [0.31, 0.39, 0.49],
        [-0.31, 0.39, 0.49],
      ],
      style.roof,
    ),
  ];
  if (part === 'exit') {
    mesh.push(
      ...box([-0.16, 0.36, 0.12], [0.16, 0.38, 0.2], GREEN),
      ...beam([-0.08, 0.39, 0.25], [0.08, 0.39, 0.25], 0.03, WHITE),
    );
  } else {
    mesh.push(...box([-0.2, 0.36, 0.18], [0.2, 0.38, 0.22], YELLOW));
  }
  return mesh.map((triangle) => ({
    material: triangle.material,
    v: triangle.v.map(([x, y, z]) => [
      x,
      y,
      z * 0.8,
    ]) as unknown as typeof triangle.v,
  }));
}
