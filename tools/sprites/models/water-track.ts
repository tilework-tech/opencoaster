import { box, beam, material, orientedBox, quad } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';
import type { TrackPieceDef } from '../../../src/sim/track/track-types';
import { offsetPoint, pieceFrames, toLevels } from './coaster/frames';

const WATER = material(ramp('blue'));
const FOAM = material(ramp('foam'));
const STONE = material(ramp('stone'));
const WOOD = material(ramp('wood'));
const TIMBER = material(ramp('timber'));
const RED = material(ramp('red'));
const SKIN = material(ramp('skin'));

export const WATER_RIDE_FAMILIES = ['log-flume', 'river-rapids'] as const;
export const WATER_CAR_PITCHES = [
  'down90',
  'down60',
  'down25',
  'flat',
  'up25',
  'up60',
  'up90',
] as const;

export function waterTrackMesh(piece: TrackPieceDef, splash = false, powered = false): Mesh {
  const mesh: Mesh = [];
  const frames = pieceFrames(piece);
  for (let i = 0; i + 1 < frames.length; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    const surface = (frame: (typeof frames)[number], side: number) =>
      offsetPoint(frame, side * 0.15, 0.06);
    mesh.push(...quad([surface(a, -1), surface(a, 1), surface(b, 1), surface(b, -1)], WATER));
    for (const side of [-1, 1]) {
      const bottomA = offsetPoint(a, side * 0.18, 0.03);
      const bottomB = offsetPoint(b, side * 0.18, 0.03);
      const wallA = offsetPoint(a, side * 0.18, 0.18);
      const wallB = offsetPoint(b, side * 0.18, 0.18);
      mesh.push(...quad([bottomA, bottomB, wallB, wallA], STONE));
      mesh.push(...beam(wallA, wallB, 0.025, WOOD, 0.025));
    }
    if (powered) {
      const left = surface(a, -0.45);
      const right = surface(b, 0.45);
      mesh.push(...beam(left, right, 0.018, FOAM, 0.02));
    }
  }
  if (splash) {
    const exit = frames[frames.length - 1];
    for (let i = 0; i < 5; i++) {
      const side = (i - 2) * 0.055;
      const at = offsetPoint(exit, side, 0.12 + (i % 2) * 0.05);
      mesh.push(
        ...box(
          [at[0] - 0.025, at[1] - 0.025, at[2]],
          [at[0] + 0.025, at[1] + 0.025, at[2] + 0.08],
          FOAM,
        ),
      );
    }
  }
  return toLevels(mesh);
}

export function waterCarMesh(family: string, heading: number, pitch: number, passengers = 0): Mesh {
  const mesh: Mesh = [];
  const angle = (heading * Math.PI) / 4;
  if (family === 'log-flume') {
    mesh.push(...orientedBox(0, 0, 0.1, 0.24, 0.11, 0.055, angle, TIMBER));
    mesh.push(...orientedBox(0, 0, 0.15, 0.21, 0.085, 0.025, angle, WOOD));
    for (let i = 0; i < Math.min(4, passengers); i++) {
      const along = (i % 2 === 0 ? -1 : 1) * 0.055;
      const across = i < 2 ? -0.035 : 0.035;
      const x = Math.cos(angle) * along - Math.sin(angle) * across;
      const y = Math.sin(angle) * along + Math.cos(angle) * across;
      mesh.push(...box([x - 0.02, y - 0.02, 0.18], [x + 0.02, y + 0.02, 0.26], SKIN));
      mesh.push(...box([x - 0.025, y - 0.025, 0.14], [x + 0.025, y + 0.025, 0.2], RED));
    }
  } else {
    mesh.push(...orientedBox(0, 0, 0.1, 0.19, 0.19, 0.045, angle, STONE));
    mesh.push(...orientedBox(0, 0, 0.15, 0.16, 0.16, 0.035, angle, FOAM));
    for (let i = 0; i < Math.min(7, passengers); i++) {
      const a = angle + i * ((Math.PI * 2) / 7);
      const x = Math.cos(a) * 0.085;
      const y = Math.sin(a) * 0.085;
      mesh.push(...box([x - 0.015, y - 0.015, 0.19], [x + 0.015, y + 0.015, 0.27], SKIN));
    }
  }
  return mesh.map((triangle) => ({
    material: triangle.material,
    v: triangle.v.map(([x, y, z]) => [
      x,
      y,
      z + (x * Math.cos(angle) + y * Math.sin(angle)) * pitch * 0.08,
    ]) as unknown as typeof triangle.v,
  }));
}
