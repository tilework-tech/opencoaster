import { SAMPLES } from '../../../../src/sim/track/catalog';
import type { TrackPieceDef } from '../../../../src/sim/track/track-types';
import { mapMesh } from '../../mesh';
import type { Mesh, Vec3 } from '../../mesh';

export const TILE_UNITS = 256;
/** Simulation height levels per tile of physical length (a level is 64 of 256 units). */
export const LEVELS_PER_TILE = TILE_UNITS / 64;

export interface Frame {
  position: Vec3;
  /** Direction of travel, right-hand side and up of the (banked) track cross-section. */
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** Rolls a cross-section about its direction of travel; positive angles lower the right side. */
export function rolled(right: Vec3, up: Vec3, bankDegrees: number): { right: Vec3; up: Vec3 } {
  const roll = (-bankDegrees * Math.PI) / 180;
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  return {
    right: [right[0] * c + up[0] * s, right[1] * c + up[1] * s, right[2] * c + up[2] * s],
    up: [up[0] * c - right[0] * s, up[1] * c - right[1] * s, up[2] * c - right[2] * s],
  };
}

/** Rotation-minimising frames along the piece centre line, rolled by the sampled bank angle. */
export function pieceFrames(piece: TrackPieceDef): Frame[] {
  const points: Vec3[] = [];
  for (let i = 0; i < piece.sampleCount; i++) {
    const at = piece.sampleStart + i;
    points.push([
      SAMPLES.x[at] / TILE_UNITS - 0.5,
      SAMPLES.y[at] / TILE_UNITS - 0.5,
      SAMPLES.z[at] / TILE_UNITS,
    ]);
  }
  const frames: Frame[] = [];
  let right: Vec3 = [0, -1, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const forward = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const projection = dot(right, forward);
    right = unit([
      right[0] - projection * forward[0],
      right[1] - projection * forward[1],
      right[2] - projection * forward[2],
    ]);
    const up = cross(right, forward);
    frames.push({
      position: points[i],
      forward,
      ...rolled(right, up, SAMPLES.bank[piece.sampleStart + i]),
    });
  }
  return frames;
}

/** Point `sideways` to the right of and `vertical` above the frame's track centre. */
export function offsetPoint(frame: Frame, sideways: number, vertical: number, along = 0): Vec3 {
  return [
    frame.position[0] + frame.right[0] * sideways + frame.up[0] * vertical + frame.forward[0] * along,
    frame.position[1] + frame.right[1] * sideways + frame.up[1] * vertical + frame.forward[1] * along,
    frame.position[2] + frame.right[2] * sideways + frame.up[2] * vertical + frame.forward[2] * along,
  ];
}

/** Models are authored in tile units on all three axes; heights then become levels. */
export function toLevels(mesh: Mesh): Mesh {
  return mapMesh(mesh, (p) => [p[0], p[1], p[2] * LEVELS_PER_TILE]);
}
