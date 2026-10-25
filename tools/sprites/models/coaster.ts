import { SAMPLES } from '../../../src/sim/track/catalog';
import type { TrackPieceDef } from '../../../src/sim/track/track-types';
import { beam, box, cylinder, mapMesh, material, rotateZ } from '../mesh';
import type { Material, Mesh, Vec3 } from '../mesh';
import { ramp } from '../palette';

export const COASTER_STYLES = ['wood', 'steel'] as const;
export type CoasterStyle = (typeof COASTER_STYLES)[number];

const TILE_UNITS = 256;
/** Simulation height levels per tile of physical length (a level is 64 of 256 units). */
const LEVELS_PER_TILE = TILE_UNITS / 64;

const mat = (name: string): Material => material(ramp(name));

interface Palette {
  rail: Material;
  tie: Material;
  bed: Material;
  support: Material;
  brace: Material;
}

const PALETTES: Record<CoasterStyle, Palette> = {
  wood: {
    rail: mat('steel'),
    tie: mat('timber'),
    bed: mat('wood'),
    support: mat('timber'),
    brace: mat('wood'),
  },
  steel: {
    rail: mat('white'),
    tie: mat('steel'),
    bed: mat('red'),
    support: mat('steel'),
    brace: mat('steel'),
  },
};

interface Frame {
  position: Vec3;
  /** Right-hand side and up directions of the (banked) track cross-section, in tile units. */
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

/** Rotation-minimising frames along the piece centre line, rolled by the sampled bank angle. */
function pieceFrames(piece: TrackPieceDef): Frame[] {
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
    const roll = (-SAMPLES.bank[piece.sampleStart + i] * Math.PI) / 180;
    const c = Math.cos(roll);
    const s = Math.sin(roll);
    frames.push({
      position: points[i],
      right: [right[0] * c + up[0] * s, right[1] * c + up[1] * s, right[2] * c + up[2] * s],
      up: [up[0] * c - right[0] * s, up[1] * c - right[1] * s, up[2] * c - right[2] * s],
    });
  }
  return frames;
}

function offsetPoint(frame: Frame, sideways: number, vertical: number): Vec3 {
  return [
    frame.position[0] + frame.right[0] * sideways + frame.up[0] * vertical,
    frame.position[1] + frame.right[1] * sideways + frame.up[1] * vertical,
    frame.position[2] + frame.right[2] * sideways + frame.up[2] * vertical,
  ];
}

/** Track pieces are authored in tile units for all three axes; heights then become levels. */
function toLevels(mesh: Mesh): Mesh {
  return mapMesh(mesh, (p) => [p[0], p[1], p[2] * LEVELS_PER_TILE]);
}

function stationPlatform(frames: Frame[], style: CoasterStyle): Mesh {
  const stone = mat('stone');
  const out: Mesh = [];
  const first = frames[0].position;
  const last = frames[frames.length - 1].position;
  for (const side of [-1, 1]) {
    const y = side * 0.24;
    out.push(...box([first[0], y - 0.08, -0.07], [last[0], y + 0.08, 0.01], stone));
  }
  out.push(...box([first[0], -0.24, 0.12], [first[0] + 0.03, -0.18, 0.3], PALETTES[style].support));
  out.push(...box([last[0] - 0.03, -0.24, 0.12], [last[0], -0.18, 0.3], PALETTES[style].support));
  out.push(...box([first[0], 0.18, 0.12], [first[0] + 0.03, 0.24, 0.3], PALETTES[style].support));
  out.push(...box([last[0] - 0.03, 0.18, 0.12], [last[0], 0.24, 0.3], PALETTES[style].support));
  out.push(
    ...box([first[0], -0.26, 0.3], [last[0], 0.26, 0.33], mat(style === 'wood' ? 'brick' : 'blue')),
  );
  return out;
}

/** Track geometry of one catalog piece in the local frame (entering along +x at the tile's west edge). */
export function trackPieceMesh(piece: TrackPieceDef, style: CoasterStyle): Mesh {
  const palette = PALETTES[style];
  const frames = pieceFrames(piece);
  const mesh: Mesh = [];
  const gauge = 0.1;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const next = frames[i + 1];
    if (next) {
      for (const side of [-gauge, gauge])
        mesh.push(
          ...beam(
            offsetPoint(frame, side, 0.05),
            offsetPoint(next, side, 0.05),
            0.045,
            palette.rail,
          ),
        );
      if (style === 'wood') {
        for (const side of [-gauge, gauge])
          mesh.push(
            ...beam(
              offsetPoint(frame, side, 0.0),
              offsetPoint(next, side, 0.0),
              0.06,
              palette.bed,
              0.07,
            ),
          );
      } else {
        mesh.push(
          ...beam(
            offsetPoint(frame, 0, -0.02),
            offsetPoint(next, 0, -0.02),
            0.09,
            palette.bed,
            0.07,
          ),
        );
      }
    }
    if (i % 2 === 0)
      mesh.push(
        ...beam(
          offsetPoint(frame, -0.14, 0.02),
          offsetPoint(frame, 0.14, 0.02),
          0.035,
          palette.tie,
          0.03,
        ),
      );
  }
  if (piece.flags & 1) mesh.push(...stationPlatform(frames, style));
  return toLevels(mesh);
}

/** One level of vertical support, repeated by the renderer from the ground up to the track. */
export function supportSegmentMesh(style: CoasterStyle, part: 'column' | 'base'): Mesh {
  const palette = PALETTES[style];
  const mesh: Mesh = [];
  const height = 1;
  if (style === 'wood') {
    for (const y of [-0.13, 0.13]) {
      mesh.push(...beam([0, y, 0], [0, y, height], 0.05, palette.support));
    }
    mesh.push(...beam([0, -0.13, 0], [0, 0.13, height], 0.03, palette.brace, 0.03));
    mesh.push(...beam([0, 0.13, 0], [0, -0.13, height], 0.03, palette.brace, 0.03));
  } else {
    mesh.push(...cylinder(0, 0, 0, height, 0.035, 0.035, 8, palette.support));
    mesh.push(...beam([-0.12, 0, height], [0.12, 0, height], 0.03, palette.brace, 0.03));
  }
  if (part === 'base') {
    mesh.push(...box([-0.1, -0.2, -0.02], [0.1, 0.2, 0.03], mat('stone')));
  }
  return mesh;
}

export type CarPitch = 'flat' | 'up25' | 'up60' | 'down25' | 'down60';
export const CAR_PITCHES: readonly CarPitch[] = ['flat', 'up25', 'up60', 'down25', 'down60'];
const PITCH_RADIANS: Record<CarPitch, number> = {
  flat: 0,
  up25: Math.atan(0.5),
  up60: Math.atan(2),
  down25: -Math.atan(0.5),
  down60: -Math.atan(2),
};
export const CAR_HEADINGS = 8;

/** A single coaster car pitched and turned to one of eight headings, centred on its origin. */
export function carMesh(style: CoasterStyle, heading: number, pitch: CarPitch): Mesh {
  const body = style === 'wood' ? mat('orange') : mat('red');
  const trim = style === 'wood' ? mat('yellow') : mat('white');
  const dark = mat('steel');
  const skin = mat('skin');
  const car: Mesh = [
    ...box([-0.14, -0.075, 0.03], [0.14, 0.075, 0.075], body),
    ...box([0.1, -0.07, 0.075], [0.14, 0.07, 0.11], body),
    ...box([-0.14, -0.075, 0.075], [-0.12, 0.075, 0.12], trim),
    ...box([-0.1, -0.06, 0.075], [-0.02, -0.01, 0.12], dark),
    ...box([-0.1, 0.01, 0.075], [-0.02, 0.06, 0.12], dark),
    ...box([0.02, -0.06, 0.075], [0.09, -0.01, 0.11], dark),
    ...box([0.02, 0.01, 0.075], [0.09, 0.06, 0.11], dark),
    ...box([-0.09, -0.05, 0.12], [-0.05, -0.02, 0.15], skin),
    ...box([-0.09, 0.02, 0.12], [-0.05, 0.05, 0.15], skin),
    ...box([-0.1, -0.08, 0], [-0.06, 0.08, 0.03], dark),
    ...box([0.06, -0.08, 0], [0.1, 0.08, 0.03], dark),
  ];
  const pitchRadians = PITCH_RADIANS[pitch];
  const pitched = mapMesh(car, (p) => {
    const c = Math.cos(pitchRadians);
    const s = Math.sin(pitchRadians);
    return [p[0] * c - (p[2] - 0.07) * s, p[1], p[0] * s + (p[2] - 0.07) * c + 0.07];
  });
  return toLevels(rotateZ(pitched, (heading / CAR_HEADINGS) * Math.PI * 2));
}

