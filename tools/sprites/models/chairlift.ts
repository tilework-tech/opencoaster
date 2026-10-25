import type { TrackPieceDef } from '../../../src/sim/track/track-types';
import { beam, box, cylinder, material } from '../mesh';
import type { Mesh } from '../mesh';
import { ramp } from '../palette';
import { offsetPoint, orientVehicle, pieceFrames, toLevels } from './coaster';
import type { CarPitch } from './coaster';
import type { TransportStyle } from './transport-track';

const mat = (name: string) => material(ramp(name));
const STEEL = mat('steel');
const STONE = mat('stone');
const YELLOW = mat('yellow');
const RED = mat('red');
const BLUE = mat('blue');
const SKIN = mat('skin');

const TOWER_EVERY = 5;
const CABLE_Z = 0.05;

/** Haul cable on lattice towers; each tower has a cross-arm and a concrete footing. */
export function chairliftTrack(piece: TrackPieceDef): Mesh {
  const frames = pieceFrames(piece);
  const mesh: Mesh = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const next = frames[i + 1];
    if (next)
      mesh.push(
        ...beam(offsetPoint(frame, 0, CABLE_Z), offsetPoint(next, 0, CABLE_Z), 0.025, STEEL, 0.02),
      );
    if (i % TOWER_EVERY === 0) {
      const [px, py, pz] = frame.position;
      const top = pz + CABLE_Z;
      mesh.push(...cylinder(px, py, 0, top, 0.035, 0.02, 6, STEEL));
      mesh.push(...box([px - 0.04, py - 0.04, 0], [px + 0.04, py + 0.04, 0.03], STONE));
      mesh.push(
        ...beam(
          offsetPoint(frame, -0.13, top - pz - 0.02),
          offsetPoint(frame, 0.13, top - pz - 0.02),
          0.025,
          YELLOW,
          0.025,
        ),
      );
    }
  }
  return toLevels(mesh);
}

/** Two-seat-style chair hung from the cable, with a backrest, a safety bar and two riders. */
function chair(): Mesh {
  const mesh: Mesh = [];
  mesh.push(...beam([0, 0, 0.07], [0, 0, -0.05], 0.015, STEEL));
  mesh.push(...box([-0.06, -0.05, -0.1], [0.06, 0.05, -0.06], RED));
  mesh.push(...box([-0.075, -0.05, -0.06], [-0.055, 0.05, 0.04], RED));
  mesh.push(...box([0.02, -0.055, -0.02], [0.04, 0.055, 0.0], BLUE));
  for (const y of [-0.03, 0.03]) {
    mesh.push(...box([-0.03, y - 0.02, -0.08], [0.02, y + 0.02, -0.05], SKIN));
  }
  return mesh;
}

export const CHAIRLIFT_STYLE: TransportStyle = {
  style: 'chairlift',
  track: chairliftTrack,
  car: (heading: number, pitch: CarPitch) => orientVehicle(chair(), heading, pitch),
};
