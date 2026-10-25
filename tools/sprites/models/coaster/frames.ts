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

/**
 * Rotation-minimising frames along the piece centre line, rolled by the sampled bank angle. The
 * world is left-handed (+x heading, +y to the right, +z up), so up is forward x right.
 */
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
  const forwards = points.map((_, i): Vec3 => {
    const at = piece.sampleStart + i;
    return unit([SAMPLES.tx[at], SAMPLES.ty[at], SAMPLES.tz[at]]);
  });
  const lateral: Vec3 = [0, 1, 0];
  const across = (forward: Vec3, from: Vec3): Vec3 => {
    const projection = dot(from, forward);
    return unit([
      from[0] - projection * forward[0],
      from[1] - projection * forward[1],
      from[2] - projection * forward[2],
    ]);
  };
  const rights: Vec3[] = [];
  if (piece.shape === 'loopLeft' || piece.shape === 'loopRight') {
    // The loop plane stays square to the lateral axis, so transporting a frame around it would
    // only accumulate twist.
    for (const forward of forwards) rights.push(across(forward, lateral));
  } else {
    let right = lateral;
    for (const forward of forwards) {
      right = across(forward, right);
      rights.push(right);
    }
    // Transport drifts by a net twist over winding pieces; spread it out so the exit cross-section
    // is the one the next piece starts with.
    const last = forwards.length - 1;
    const turned: Vec3 = [
      [0, -1, 0, 1][piece.headingDelta & 3] ?? 0,
      [1, 0, -1, 0][piece.headingDelta & 3] ?? 0,
      0,
    ];
    const wanted = across(forwards[last], turned);
    const twist = Math.atan2(
      dot(cross(rights[last], wanted), forwards[last]),
      dot(rights[last], wanted),
    );
    rights.forEach((r, i) => {
      const angle = (twist * i) / last;
      const f = forwards[i];
      const side = cross(f, r);
      rights[i] = unit([
        r[0] * Math.cos(angle) + side[0] * Math.sin(angle),
        r[1] * Math.cos(angle) + side[1] * Math.sin(angle),
        r[2] * Math.cos(angle) + side[2] * Math.sin(angle),
      ]);
    });
  }
  return points.map((position, i) => ({
    position,
    forward: forwards[i],
    ...rolled(rights[i], cross(forwards[i], rights[i]), SAMPLES.bank[piece.sampleStart + i]),
  }));
}

/** Point `sideways` to the right of and `vertical` above the frame's track centre. */
export function offsetPoint(frame: Frame, sideways: number, vertical: number, along = 0): Vec3 {
  return [
    frame.position[0] +
      frame.right[0] * sideways +
      frame.up[0] * vertical +
      frame.forward[0] * along,
    frame.position[1] +
      frame.right[1] * sideways +
      frame.up[1] * vertical +
      frame.forward[1] * along,
    frame.position[2] +
      frame.right[2] * sideways +
      frame.up[2] * vertical +
      frame.forward[2] * along,
  ];
}

/** Models are authored in tile units on all three axes; heights then become levels. */
export function toLevels(mesh: Mesh): Mesh {
  return mapMesh(mesh, (p) => [p[0], p[1], p[2] * LEVELS_PER_TILE]);
}
