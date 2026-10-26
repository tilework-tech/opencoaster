import { box, cylinder } from '../../mesh';
import type { Mesh } from '../../mesh';
import { material } from '../../mesh';
import { ramp } from '../../palette';
import { RIDE_MODELS } from '../rides';
import type { RideModel } from '../rides';

const BODY = material(ramp('blue'));
const ALT_BODY = material(ramp('red'));
const SKIN = material(ramp('skin'));

export type Seat = readonly [x: number, y: number, z: number];

export function rider(x: number, y: number, z: number, color = BODY): Mesh {
  return [
    ...box([x - 0.055, y - 0.05, z], [x + 0.055, y + 0.05, z + 0.15], color),
    ...cylinder(x, y, z + 0.15, z + 0.24, 0.05, 0.05, 6, SKIN, { capBottom: true }),
  ];
}

export function withRiders(name: string, seatsAt: (frame: number) => readonly Seat[]): RideModel {
  const base = RIDE_MODELS.find((model) => model.key === `rides/${slug(name)}`);
  if (!base) throw new Error(`Missing base ride model for ${name}`);
  return {
    key: base.key,
    frames: 9,
    build(frame) {
      if (frame === 0) return base.build(-1);
      const operationFrame = frame - 1;
      const mesh = base.build(operationFrame);
      for (const [index, [x, y, z]] of seatsAt(operationFrame).entries())
        mesh.push(...rider(x, y, z, index % 2 === 0 ? BODY : ALT_BODY));
      return mesh;
    },
  };
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
