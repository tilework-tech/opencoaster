import type { TrackPieceDef } from '../../../src/sim/track/track-types';
import { beam, box, cylinder, material } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';
import { offsetPoint, orientVehicle, pieceFrames, toLevels } from './coaster';
import type { CarPitch } from './coaster';
import type { TransportStyle } from './transport-track';

const mat = (name: string) => material(ramp(name));
const STEEL = mat('steel');
const WOOD = mat('wood');
const STONE = mat('stone');
const RED = mat('red');
const BLACK = mat('glass');
const GREEN = mat('green');
const YELLOW = mat('yellow');
const WHITE = mat('white');

const GAUGE = 0.09;
const RAIL_Z = 0.05;

/** Narrow-gauge rails on timber sleepers over a stone ballast bed. */
export function railTrack(piece: TrackPieceDef): Mesh {
  const frames = pieceFrames(piece);
  const mesh: Mesh = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const next = frames[i + 1];
    if (next) {
      mesh.push(
        ...beam(offsetPoint(frame, 0, -0.02), offsetPoint(next, 0, -0.02), 0.12, STONE, 0.035),
      );
      for (const side of [-GAUGE, GAUGE])
        mesh.push(
          ...beam(offsetPoint(frame, side, RAIL_Z), offsetPoint(next, side, RAIL_Z), 0.03, STEEL),
        );
    }
    if (i % 2 === 0)
      mesh.push(
        ...beam(offsetPoint(frame, -0.15, 0), offsetPoint(frame, 0.15, 0), 0.04, WOOD, 0.03),
      );
  }
  return toLevels(mesh);
}

/** Steam-style loco with a boiler, chimney and cab, pulling one open carriage. */
function railTrain(): Mesh {
  const mesh: Mesh = [];
  mesh.push(...box([-0.16, -0.06, 0.07], [0.02, 0.06, 0.2], RED));
  mesh.push(...box([-0.2, -0.07, 0.07], [-0.14, 0.07, 0.24], GREEN));
  mesh.push(...box([-0.14, -0.05, 0.2], [0.02, 0.05, 0.24], BLACK));
  mesh.push(...cylinder(-0.06, 0, 0.2, 0.26, 0.035, 0.035, 8, STEEL, { capTop: true }));
  mesh.push(...box([-0.04, -0.07, 0.07], [0.02, 0.07, 0.11], YELLOW));
  mesh.push(...box([0.04, -0.07, 0.07], [0.22, 0.07, 0.18], WOOD));
  mesh.push(...box([0.04, -0.07, 0.18], [0.22, 0.07, 0.2], YELLOW));
  mesh.push(...box([0.04, -0.07, 0.07], [0.22, -0.055, 0.2], WHITE));
  mesh.push(...box([0.04, 0.055, 0.07], [0.22, 0.07, 0.2], WHITE));
  for (const [x, y] of [
    [-0.1, -0.06],
    [-0.1, 0.06],
    [0.14, -0.06],
    [0.14, 0.06],
  ] as const) {
    mesh.push(...cylinder(x, y, 0.0, 0.07, 0.035, 0.035, 8, BLACK, { capBottom: true }));
  }
  return mesh;
}

export const MINIATURE_RAILWAY_STYLE: TransportStyle = {
  style: 'rail',
  track: railTrack,
  car: (heading: number, pitch: CarPitch) => orientVehicle(railTrain(), heading, pitch),
};
