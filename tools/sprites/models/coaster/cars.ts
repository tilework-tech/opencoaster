import { box, material, polygon, rotateY, rotateZ } from '../../mesh';
import type { Material, Mesh, Vec3 } from '../../mesh';
import { ramp } from '../../palette';
import { rolled, toLevels } from './frames';
import type { CoasterFamily } from './families';

export const CAR_HEADINGS = 8;
/** Pitch classes -3..3: 90, 63 and 27 degrees down, level, then the same up. */
export const CAR_PITCH_DEGREES = [-90, -63.4, -26.6, 0, 26.6, 63.4, 90] as const;
export const CAR_PITCH_NAMES = ['down90', 'down60', 'down25', 'flat', 'up25', 'up60', 'up90'] as const;
export const CAR_BANK_NAMES = ['level', 'left', 'right', 'inverted'] as const;
/** Roll in track-bank degrees (positive lowers the right side) for each bank class. */
const BANK_DEGREES = [0, -55, 55, 180] as const;

const mat = (name: string): Material => material(ramp(name));

interface CarLook {
  length: number;
  width: number;
  body: Material;
  trim: Material;
  seat: Material;
  nose?: Material;
  rows: number;
}

const CAR_LOOKS: Record<CoasterFamily, CarLook> = {
  wood: { length: 0.17, width: 0.2, body: mat('orange'), trim: mat('yellow'), seat: mat('wood'), rows: 2 },
  steel: { length: 0.17, width: 0.2, body: mat('red'), trim: mat('white'), seat: mat('steel'), rows: 2 },
  junior: { length: 0.15, width: 0.17, body: mat('yellow'), trim: mat('blue'), seat: mat('steel'), rows: 2 },
  mouse: {
    length: 0.16,
    width: 0.15,
    body: mat('steel'),
    trim: mat('white'),
    seat: mat('purple'),
    nose: mat('pink'),
    rows: 1,
  },
};

/** One car centred on the rail line, nose toward +x, standing on the rails (z = 0 is rail level). */
function carShape(family: CoasterFamily): Mesh {
  const look = CAR_LOOKS[family];
  const l = look.length / 2;
  const w = look.width / 2;
  const dark = mat('steel');
  const out: Mesh = [
    ...box([-l, -w, 0.035], [l, w, 0.075], look.body),
    ...box([-l, -w, 0.075], [l, -w + 0.022, 0.115], look.body),
    ...box([-l, w - 0.022, 0.075], [l, w, 0.115], look.body),
    ...box([-l, -w, 0.075], [-l + 0.022, w, 0.125], look.trim),
    ...polygon(
      [
        [l, -w, 0.035],
        [l, w, 0.035],
        [l, w, 0.115],
        [l, -w, 0.115],
      ],
      look.trim,
    ),
  ];
  const rowSpacing = (look.length - 0.05) / look.rows;
  for (let row = 0; row < look.rows; row++) {
    const x = -l + 0.035 + row * rowSpacing;
    out.push(
      ...box([x, -w + 0.025, 0.075], [x + 0.03, w - 0.025, 0.135], look.seat),
      ...box([x + 0.05, -w + 0.02, 0.075], [x + 0.058, w - 0.02, 0.125], look.trim),
    );
  }
  if (look.nose) {
    out.push(
      ...box([l - 0.015, -0.03, 0.075], [l + 0.03, 0.03, 0.105], look.nose),
      ...box([-l + 0.02, -w + 0.01, 0.115], [-l + 0.05, -w + 0.04, 0.16], look.nose),
      ...box([-l + 0.02, w - 0.04, 0.115], [-l + 0.05, w - 0.01, 0.16], look.nose),
    );
  }
  for (const x of [-l * 0.6, l * 0.6])
    for (const y of [-w, w])
      out.push(...box([x - 0.025, y - 0.012, 0.0], [x + 0.025, y + 0.012, 0.045], dark));
  return out;
}

/** A car at one of 8 world headings, pitched and rolled to sit on track of the given class. */
export function carMesh(
  family: CoasterFamily,
  heading: number,
  pitch: number,
  bank: number,
): Mesh {
  const frame = rolled([0, -1, 0], [0, 0, 1], BANK_DEGREES[bank]);
  const rolledMesh: Mesh = carShape(family).map((t) => ({
    material: t.material,
    v: t.v.map((p): Vec3 => {
      const lateral = -p[1];
      return [
        p[0],
        lateral * frame.right[1] + p[2] * frame.up[1],
        lateral * frame.right[2] + p[2] * frame.up[2],
      ];
    }) as unknown as (typeof t)['v'],
  }));
  const pitched = rotateY(rolledMesh, (-CAR_PITCH_DEGREES[pitch + 3] * Math.PI) / 180, 0, 0);
  return toLevels(rotateZ(pitched, (heading / CAR_HEADINGS) * Math.PI * 2));
}
