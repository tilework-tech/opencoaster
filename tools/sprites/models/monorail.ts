import type { TrackPieceDef } from '../../../src/sim/track/track-types';
import { beam, box, material } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';
import { offsetPoint, orientVehicle, pieceFrames, toLevels } from './coaster';
import type { CarPitch } from './coaster';
import type { TransportStyle } from './transport-track';

const mat = (name: string) => material(ramp(name));
const CONCRETE = mat('white');
const STEEL = mat('steel');
const BLUE = mat('blue');
const GLASS = mat('glass');
const YELLOW = mat('yellow');

const PYLON_EVERY = 3;

/** Box-section girder carried on steel pylons that reach down to the tile base. */
export function monorailTrack(piece: TrackPieceDef): Mesh {
  const frames = pieceFrames(piece);
  const mesh: Mesh = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const next = frames[i + 1];
    if (next) {
      mesh.push(
        ...beam(offsetPoint(frame, 0, -0.02), offsetPoint(next, 0, -0.02), 0.14, CONCRETE, 0.09),
      );
      mesh.push(...beam(offsetPoint(frame, 0, 0.03), offsetPoint(next, 0, 0.03), 0.03, BLUE, 0.02));
    }
    if (i % PYLON_EVERY === 0) {
      const [px, py, pz] = frame.position;
      mesh.push(...beam([px, py, 0], [px, py, pz - 0.03], 0.05, STEEL));
      mesh.push(...box([px - 0.04, py - 0.04, 0], [px + 0.04, py + 0.04, 0.03], CONCRETE));
    }
  }
  return toLevels(mesh);
}

/** Pod that hangs below the girder, with a glazed band, roof trim, and bogies gripping the beam. */
function monorailPod(): Mesh {
  const mesh: Mesh = [];
  mesh.push(...box([-0.16, -0.07, -0.15], [0.16, 0.07, -0.01], BLUE));
  mesh.push(...box([-0.16, -0.075, -0.1], [0.16, 0.075, -0.06], GLASS));
  mesh.push(...box([-0.16, -0.07, -0.16], [0.16, 0.07, -0.14], YELLOW));
  mesh.push(...box([-0.07, -0.04, 0.0], [0.07, 0.04, 0.05], STEEL));
  return mesh;
}

export const MONORAIL_STYLE: TransportStyle = {
  style: 'monorail',
  track: monorailTrack,
  car: (heading: number, pitch: CarPitch) => orientVehicle(monorailPod(), heading, pitch),
};
