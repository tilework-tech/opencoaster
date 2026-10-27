import type { World } from '../core/world';
import { TILE_UNITS, TRACK_Z_STEP } from '../core/constants';
import { PIECES, SAMPLES } from './catalog';
import { MAX_TRACK_RIDES } from './track-store';

/**
 * A ride's whole centre line as one polyline in world coordinates, for the vehicle system.
 *
 * Points run from the head piece to the tail piece. For a closed circuit the final point repeats
 * the first one with `s === length`, so a train at `s` wraps with `s % length`. All values are
 * integers: positions in TILE_UNITS (z in the same unit scale, Z_STEP per land level), tangents
 * scaled by TANGENT_ONE, bank in degrees, `s` the arclength from point 0.
 */
export interface TrackPath {
  rideId: number;
  /** Matches TrackState.version when the path is current. */
  version: number;
  closed: boolean;
  count: number;
  /** Total length in TILE_UNITS (equal to `s[count - 1]`). */
  length: number;
  x: Int32Array;
  y: Int32Array;
  z: Int32Array;
  tx: Int16Array;
  ty: Int16Array;
  tz: Int16Array;
  bank: Int16Array;
  s: Int32Array;
  /** PieceMode of the piece each point belongs to; the end point takes the last piece's mode. */
  mode: Uint8Array;
  /** Entity id of the owning piece. */
  piece: Int32Array;
  /** Index of the first point of each piece, in chain order, plus a final entry equal to count. */
  pieceStart: Int32Array;
}

/** Returns the ride's current path, rebuilding it only when the track changed. */
export function getTrackPath(world: World, rideId: number): TrackPath | null {
  const t = world.track;
  if (rideId < 0 || rideId >= MAX_TRACK_RIDES || t.head[rideId] < 0) return null;
  const cached = t.paths[rideId];
  if (cached && cached.version === t.version[rideId]) return cached;
  const path = buildTrackPath(world, rideId);
  t.paths[rideId] = path;
  return path;
}

export function buildTrackPath(world: World, rideId: number): TrackPath {
  const t = world.track;
  const c = t.pieces.cols;
  const closed = t.closed[rideId] === 1;

  let total = 1;
  let chain = 0;
  let id = t.head[rideId];
  do {
    const slot = t.pieces.idToSlot[id];
    total += PIECES[c.pieceType[slot]].sampleCount - 1;
    chain++;
    id = c.next[slot];
  } while (id >= 0 && id !== t.head[rideId]);

  const path: TrackPath = {
    rideId,
    version: t.version[rideId],
    closed,
    count: total,
    length: 0,
    x: new Int32Array(total),
    y: new Int32Array(total),
    z: new Int32Array(total),
    tx: new Int16Array(total),
    ty: new Int16Array(total),
    tz: new Int16Array(total),
    bank: new Int16Array(total),
    s: new Int32Array(total),
    mode: new Uint8Array(total),
    piece: new Int32Array(total),
    pieceStart: new Int32Array(chain + 1),
  };

  const half = TILE_UNITS / 2;
  let n = 0;
  let pi = 0;
  id = t.head[rideId];
  do {
    const slot = t.pieces.idToSlot[id];
    const def = PIECES[c.pieceType[slot]];
    const dir = c.dir[slot];
    const ox = c.x[slot] * TILE_UNITS;
    const oy = c.y[slot] * TILE_UNITS;
    const oz = c.z[slot] * TRACK_Z_STEP;
    path.pieceStart[pi++] = n;
    const last = c.next[slot] < 0;
    const end = def.sampleStart + (last ? def.sampleCount : def.sampleCount - 1);
    for (let k = def.sampleStart; k < end; k++, n++) {
      const lx = SAMPLES.x[k] - half;
      const ly = SAMPLES.y[k] - half;
      const ltx = SAMPLES.tx[k];
      const lty = SAMPLES.ty[k];
      let px: number, py: number, qx: number, qy: number;
      switch (dir) {
        case 0:
          px = lx;
          py = ly;
          qx = ltx;
          qy = lty;
          break;
        case 1:
          px = -ly;
          py = lx;
          qx = -lty;
          qy = ltx;
          break;
        case 2:
          px = -lx;
          py = -ly;
          qx = -ltx;
          qy = -lty;
          break;
        default:
          px = ly;
          py = -lx;
          qx = lty;
          qy = -ltx;
      }
      path.x[n] = ox + half + px;
      path.y[n] = oy + half + py;
      path.z[n] = oz + SAMPLES.z[k];
      path.tx[n] = qx;
      path.ty[n] = qy;
      path.tz[n] = SAMPLES.tz[k];
      path.bank[n] = SAMPLES.bank[k];
      path.mode[n] = c.mode[slot];
      path.piece[n] = id;
    }
    id = c.next[slot];
  } while (id >= 0 && id !== t.head[rideId]);
  path.pieceStart[pi] = n;

  if (closed) {
    path.x[n] = path.x[0];
    path.y[n] = path.y[0];
    path.z[n] = path.z[0];
    path.tx[n] = path.tx[0];
    path.ty[n] = path.ty[0];
    path.tz[n] = path.tz[0];
    path.bank[n] = path.bank[0];
    path.mode[n] = path.mode[n - 1];
    path.piece[n] = path.piece[n - 1];
    n++;
  }
  path.count = n;
  let s = 0;
  for (let i = 1; i < n; i++) {
    const dx = path.x[i] - path.x[i - 1];
    const dy = path.y[i] - path.y[i - 1];
    const dz = path.z[i] - path.z[i - 1];
    s += Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz));
    path.s[i] = s;
  }
  path.length = s;
  return path;
}
