import { PieceFlag } from '../../../../src/sim/track/track-types';
import type { TrackPieceDef } from '../../../../src/sim/track/track-types';
import { beam, box, polygon, material } from '../../mesh';
import type { Material, Mesh, Vec3 } from '../../mesh';
import { ramp } from '../../palette';
import { offsetPoint, pieceFrames, toLevels } from './frames';
import type { Frame } from './frames';
import { TRACK_LOOKS } from './families';
import type { TrackArt, TrackLook } from './families';

export type TrackVariant = '' | '+chain' | '+brake' | '+block';
export const CHAIN_FRAMES = 2;

const stone = material(ramp('stone'));
const dark = material(ramp('steel'));

/** Frames resampled at fixed arc-length steps so ties and links are evenly spaced on curves. */
function atArc(frames: Frame[], spacing: number, phase: number): Frame[] {
  const out: Frame[] = [];
  let travelled = 0;
  let next = phase;
  for (let i = 0; i + 1 < frames.length; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    const length = Math.hypot(
      b.position[0] - a.position[0],
      b.position[1] - a.position[1],
      b.position[2] - a.position[2],
    );
    while (next < travelled + length) {
      const t = (next - travelled) / length;
      const lerp = (p: Vec3, q: Vec3): Vec3 => [
        p[0] + (q[0] - p[0]) * t,
        p[1] + (q[1] - p[1]) * t,
        p[2] + (q[2] - p[2]) * t,
      ];
      out.push({
        position: lerp(a.position, b.position),
        forward: lerp(a.forward, b.forward),
        right: lerp(a.right, b.right),
        up: lerp(a.up, b.up),
      });
      next += spacing;
    }
    travelled += length;
  }
  return out;
}

function bodyMesh(frames: Frame[], look: TrackLook): Mesh {
  const mesh: Mesh = [];
  for (let i = 0; i + 1 < frames.length; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    for (const side of [-look.gauge, look.gauge]) {
      mesh.push(
        ...beam(
          offsetPoint(a, side, 0.045),
          offsetPoint(b, side, 0.045),
          look.railSize,
          look.rail,
          look.railSize,
        ),
      );
      if (look.stringers) {
        const s = look.stringers;
        mesh.push(
          ...beam(
            offsetPoint(a, side, 0.045 - s.drop),
            offsetPoint(b, side, 0.045 - s.drop),
            s.width,
            s.mat,
            s.depth,
          ),
        );
      }
    }
    if (look.spine) {
      const s = look.spine;
      mesh.push(
        ...beam(
          offsetPoint(a, 0, 0.045 - s.drop),
          offsetPoint(b, 0, 0.045 - s.drop),
          s.width,
          s.mat,
          s.depth,
        ),
      );
    }
  }
  const t = look.tie;
  for (const frame of atArc(frames, t.spacing, t.spacing / 2)) {
    mesh.push(
      ...beam(
        offsetPoint(frame, -t.halfWidth, 0.01),
        offsetPoint(frame, t.halfWidth, 0.01),
        t.thickness,
        t.mat,
        0.03,
      ),
    );
  }
  return mesh;
}

function chainMesh(frames: Frame[], look: TrackLook, phase: number): Mesh {
  const spacing = 0.0625;
  const links: Mesh = [];
  atArc(frames, spacing, (phase / CHAIN_FRAMES) * spacing).forEach((frame, index) => {
    const mat: Material = index % 2 === 0 ? look.chain : dark;
    links.push(
      ...beam(
        offsetPoint(frame, 0, 0.085, -0.022),
        offsetPoint(frame, 0, 0.085, 0.022),
        0.045,
        mat,
        0.04,
      ),
    );
  });
  return links;
}

function brakeMesh(frames: Frame[], look: TrackLook, block: boolean): Mesh {
  const mesh: Mesh = [];
  const fin = block ? look.blockBrake : look.brake;
  for (let i = 0; i + 1 < frames.length; i++) {
    for (const side of [-0.05, 0.05])
      mesh.push(
        ...beam(
          offsetPoint(frames[i], side, 0.085),
          offsetPoint(frames[i + 1], side, 0.085),
          0.03,
          fin,
          0.07,
        ),
      );
  }
  if (block) {
    const mid = frames[Math.floor(frames.length / 2)];
    const post = offsetPoint(mid, look.gauge + 0.1, 0);
    mesh.push(
      ...beam(post, [post[0], post[1], post[2] + 0.22], 0.025, dark),
      ...box(
        [post[0] - 0.035, post[1] - 0.035, post[2] + 0.22],
        [post[0] + 0.035, post[1] + 0.035, post[2] + 0.29],
        material(ramp('red')),
      ),
    );
  }
  return mesh;
}

function stationMesh(look: TrackLook): Mesh {
  const out: Mesh = [];
  const { roof, pillar, trim } = look.station;
  for (const side of [-1, 1]) {
    const inner = side * 0.14;
    const outer = side * 0.34;
    out.push(
      ...box([-0.5, Math.min(inner, outer), -0.02], [0.5, Math.max(inner, outer), 0.06], stone),
      ...box(
        [-0.5, Math.min(inner, side * 0.16), 0.06],
        [0.5, Math.max(inner, side * 0.16), 0.065],
        trim,
      ),
    );
    for (const x of [-0.42, 0.42])
      out.push(
        ...box([x - 0.025, side * 0.31 - 0.025, 0.06], [x + 0.025, side * 0.31 + 0.025, 0.36], pillar),
      );
  }
  const eave = 0.35;
  const ridge = 0.45;
  const w = 0.4;
  out.push(
    ...polygon(
      [
        [-0.5, -w, eave],
        [0.5, -w, eave],
        [0.5, 0, ridge],
        [-0.5, 0, ridge],
      ],
      roof,
    ),
    ...polygon(
      [
        [-0.5, w, eave],
        [-0.5, 0, ridge],
        [0.5, 0, ridge],
        [0.5, w, eave],
      ],
      roof,
    ),
    ...box([-0.5, -w, eave - 0.03], [0.5, -w + 0.03, eave], trim),
    ...box([-0.5, w - 0.03, eave - 0.03], [0.5, w, eave], trim),
  );
  return out;
}

/** Variant a piece can show for a drive mode: chain only on lift-capable, brakes on brake-capable. */
export function variantsOf(piece: TrackPieceDef): TrackVariant[] {
  const out: TrackVariant[] = [''];
  if (piece.flags & PieceFlag.LiftOk) out.push('+chain');
  if (piece.flags & PieceFlag.BrakeOk) out.push('+brake', '+block');
  return out;
}

/** Track geometry of one catalog piece in its local frame (entering along +x at the west edge). */
export function trackPieceMesh(
  piece: TrackPieceDef,
  art: TrackArt,
  variant: TrackVariant = '',
  chainPhase = 0,
): Mesh {
  const look = TRACK_LOOKS[art];
  const frames = pieceFrames(piece);
  const mesh = bodyMesh(frames, look);
  if (variant === '+chain') mesh.push(...chainMesh(frames, look, chainPhase));
  if (variant === '+brake') mesh.push(...brakeMesh(frames, look, false));
  if (variant === '+block') mesh.push(...brakeMesh(frames, look, true));
  if (piece.flags & PieceFlag.Station) mesh.push(...stationMesh(look));
  return toLevels(mesh);
}
