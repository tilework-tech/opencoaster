import { box, cylinder } from '../../mesh';
import type { Material, Mesh } from '../../mesh';
import type { FacilityModel } from './common';
import { counterBooth, facilityMaterials as m, stripedCanopy } from './common';

type ShopStyle = {
  slug: string;
  wall: Material;
  roof: Material;
  stripes: readonly [Material, Material];
  /** Wares displayed on the counter and above the roof. */
  display: (frame: number) => Mesh;
};

function balloonBunch(frame: number): Mesh {
  const colours = [m.red, m.yellow, m.blue, m.green];
  const mesh: Mesh = [...cylinder(0, 0.12, 0.43, 0.62, 0.012, 0.012, 6, m.white)];
  for (let i = 0; i < 4; i++) {
    const x = -0.18 + i * 0.12;
    const bob = (frame + i) % 2 === 0 ? 0.02 : 0;
    mesh.push(
      ...cylinder(x, 0.12, 0.6 + bob, 0.66 + bob, 0.04, 0.06, 8, colours[i]),
      ...cylinder(x, 0.12, 0.66 + bob, 0.74 + bob, 0.06, 0.02, 8, colours[i]),
    );
  }
  return mesh;
}

function hatRack(): Mesh {
  return [
    ...cylinder(-0.18, 0.2, 0.2, 0.22, 0.09, 0.09, 10, m.red),
    ...cylinder(-0.18, 0.2, 0.22, 0.3, 0.05, 0.04, 10, m.red),
    ...cylinder(0.02, 0.2, 0.2, 0.22, 0.09, 0.09, 10, m.blue),
    ...cylinder(0.02, 0.2, 0.22, 0.3, 0.05, 0.04, 10, m.blue),
    ...cylinder(0.2, 0.2, 0.2, 0.22, 0.09, 0.09, 10, m.yellow),
    ...cylinder(0.2, 0.2, 0.22, 0.3, 0.05, 0.04, 10, m.yellow),
  ];
}

function iceCreamCone(): Mesh {
  return [
    ...cylinder(0, 0.1, 0.43, 0.56, 0.08, 0.02, 8, m.wood),
    ...cylinder(0, 0.1, 0.56, 0.64, 0.09, 0.07, 8, m.white),
    ...cylinder(0, 0.1, 0.64, 0.7, 0.07, 0.03, 8, m.red),
  ];
}

function candyflossCone(): Mesh {
  return [
    ...cylinder(-0.12, 0.1, 0.43, 0.58, 0.015, 0.015, 6, m.white),
    ...cylinder(-0.12, 0.1, 0.55, 0.66, 0.1, 0.06, 10, m.purple),
    ...cylinder(0.12, 0.1, 0.43, 0.58, 0.015, 0.015, 6, m.white),
    ...cylinder(0.12, 0.1, 0.55, 0.66, 0.1, 0.06, 10, m.red),
  ];
}

function popcornMachine(): Mesh {
  return [
    ...box([-0.14, -0.1, 0.43], [0.14, 0.14, 0.6], m.glass),
    ...box([-0.16, -0.12, 0.6], [0.16, 0.16, 0.66], m.red),
    ...cylinder(0, 0.02, 0.66, 0.74, 0.1, 0.06, 8, m.yellow),
  ];
}

function pizzaBoard(): Mesh {
  return [
    ...cylinder(-0.1, 0.2, 0.2, 0.215, 0.12, 0.12, 12, m.orange),
    ...cylinder(-0.1, 0.2, 0.215, 0.225, 0.1, 0.1, 12, m.red),
    ...box([0.14, 0.14, 0.2], [0.3, 0.3, 0.26], m.white),
  ];
}

function chipsBasket(): Mesh {
  return [
    ...box([-0.2, 0.15, 0.2], [-0.02, 0.3, 0.3], m.yellow),
    ...box([0.04, 0.15, 0.2], [0.22, 0.3, 0.3], m.orange),
    ...box([-0.1, -0.1, 0.43], [0.1, 0.1, 0.52], m.steel),
  ];
}

function tShirtRail(): Mesh {
  return [
    ...box([-0.25, 0.2, 0.28], [0.25, 0.23, 0.3], m.steel),
    ...box([-0.22, 0.2, 0.17], [-0.08, 0.23, 0.28], m.blue),
    ...box([-0.04, 0.2, 0.17], [0.1, 0.23, 0.28], m.green),
    ...box([0.12, 0.2, 0.17], [0.26, 0.23, 0.28], m.red),
  ];
}

const STYLES: readonly ShopStyle[] = [
  {
    slug: 'chips-stall',
    wall: m.timber,
    roof: m.yellow,
    stripes: [m.yellow, m.white],
    display: chipsBasket,
  },
  {
    slug: 'ice-cream-stall',
    wall: m.white,
    roof: m.blue,
    stripes: [m.blue, m.white],
    display: iceCreamCone,
  },
  {
    slug: 'candyfloss-stall',
    wall: m.purple,
    roof: m.red,
    stripes: [m.purple, m.white],
    display: candyflossCone,
  },
  {
    slug: 'balloon-stall',
    wall: m.blue,
    roof: m.red,
    stripes: [m.red, m.yellow],
    display: balloonBunch,
  },
  {
    slug: 'pizza-stall',
    wall: m.brick,
    roof: m.green,
    stripes: [m.green, m.white],
    display: pizzaBoard,
  },
  {
    slug: 'popcorn-stall',
    wall: m.red,
    roof: m.white,
    stripes: [m.red, m.white],
    display: popcornMachine,
  },
  {
    slug: 'hat-stall',
    wall: m.green,
    roof: m.orange,
    stripes: [m.orange, m.white],
    display: hatRack,
  },
  {
    slug: 'souvenir-stall',
    wall: m.stone,
    roof: m.blue,
    stripes: [m.blue, m.yellow],
    display: tShirtRail,
  },
];

export const SHOP_STALL_MODELS: readonly FacilityModel[] = STYLES.map((style) => ({
  key: `facilities/${style.slug}`,
  frames: 4,
  build: (frame: number): Mesh => [
    ...counterBooth(style.wall, style.roof, frame),
    ...stripedCanopy(style.stripes[0], style.stripes[1], frame),
    ...style.display(frame),
  ],
}));
