import { TILE_UNITS, TRACK_Z_STEP } from '../sim/core/constants';
import { PIECES } from '../sim/track/catalog';
import { pieceExit, rotateTile } from '../sim/track/construction';
import type { Bank, Slope, TrackPieceDef } from '../sim/track/track-types';
import type { RideType } from '../sim/rides/ride-types';
import { SNAPSHOT_STRIDE, TRACK_LINK_STRIDE } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import { resolvePiece, resolvePieceBefore } from './track-tool';
import type { PieceChoice } from './track-tool';

/** A placed track piece as published in a snapshot. Heights are in track steps. */
export interface SnapshotPiece {
  id: number;
  rideId: number;
  pieceType: number;
  x: number;
  y: number;
  z: number;
  dir: number;
  mode: number;
  /** Ids of the pieces before and after it (-1 at an open end). */
  prev: number;
  next: number;
}

/** Which side of a selected piece new track is built on. */
export type BuildEnd = 'after' | 'before';

/** An open end of a section: where a new piece starts ('after') or ends ('before'). */
export interface BuildPoint {
  end: BuildEnd;
  x: number;
  y: number;
  z: number;
  dir: number;
  slope: Slope;
  bank: Bank;
}

export interface BuildChoice {
  piece: TrackPieceDef;
  /** Origin tile, entry height in track steps and heading of the piece to place. */
  placement: { x: number; y: number; z: number; dir: number };
}

/** Track row of each piece id, rebuilt once per published snapshot revision. */
const rowIndex = new WeakMap<Snapshot, { revision: number; rows: Map<number, number> }>();

function rowOf(snapshot: Snapshot, pieceId: number): number {
  if (pieceId < 0) return -1;
  let index = rowIndex.get(snapshot);
  if (!index || index.revision !== snapshot.revision) {
    const rows = new Map<number, number>();
    for (let row = 0; row < snapshot.tracks.count; row++)
      rows.set(snapshot.trackLinks[row * TRACK_LINK_STRIDE], row);
    index = { revision: snapshot.revision, rows };
    rowIndex.set(snapshot, index);
  }
  return index.rows.get(pieceId) ?? -1;
}

/** The piece with this stable id in the snapshot, or null when it no longer exists. */
export function snapshotPiece(snapshot: Snapshot, pieceId: number): SnapshotPiece | null {
  const row = rowOf(snapshot, pieceId);
  if (row < 0) return null;
  const data = snapshot.tracks.data;
  const o = row * SNAPSHOT_STRIDE;
  const word = data[o + 3];
  const link = row * TRACK_LINK_STRIDE;
  return {
    id: pieceId,
    rideId: word >>> 16,
    pieceType: word & 0xff,
    x: Math.floor(data[o] / TILE_UNITS),
    y: Math.floor(data[o + 1] / TILE_UNITS),
    z: data[o + 2] / TRACK_Z_STEP,
    dir: (word >> 8) & 3,
    mode: (word >> 10) & 7,
    prev: snapshot.trackLinks[link + 1],
    next: snapshot.trackLinks[link + 2],
  };
}

/** The id of the piece before or after `pieceId` along the track, or -1 at an open end. */
export function neighbourPiece(
  snapshot: Snapshot,
  pieceId: number,
  step: 'previous' | 'next',
): number {
  const piece = snapshotPiece(snapshot, pieceId);
  if (!piece) return -1;
  return step === 'previous' ? piece.prev : piece.next;
}

/** Where the piece sits in its section (0-based from the section's first piece). */
export function sectionPosition(
  snapshot: Snapshot,
  pieceId: number,
): { index: number; count: number; ring: boolean } {
  const ahead: number[] = [];
  for (let id = neighbourPiece(snapshot, pieceId, 'next'); id >= 0 && id !== pieceId;)
    id = neighbourPiece(snapshot, ahead[ahead.push(id) - 1], 'next');
  const ring =
    ahead.length > 0 && neighbourPiece(snapshot, ahead[ahead.length - 1], 'next') === pieceId;
  if (ring) {
    const loop = [pieceId, ...ahead];
    const isStation = (id: number): boolean =>
      PIECES[snapshotPiece(snapshot, id)!.pieceType]?.shape === 'station';
    let start = loop.findIndex(
      (id, k) => isStation(id) && !isStation(loop[(k + loop.length - 1) % loop.length]),
    );
    if (start < 0) start = loop.indexOf(Math.min(...loop));
    return { index: (loop.length - start) % loop.length, count: loop.length, ring };
  }
  let index = 0;
  for (let id = neighbourPiece(snapshot, pieceId, 'previous'); id >= 0; index++)
    id = neighbourPiece(snapshot, id, 'previous');
  return { index, count: index + 1 + ahead.length, ring };
}

/** The open ends of a piece new track can be built on. */
export function openEnds(piece: SnapshotPiece): BuildEnd[] {
  const ends: BuildEnd[] = [];
  if (piece.next < 0) ends.push('after');
  if (piece.prev < 0) ends.push('before');
  return ends;
}

/** The connection a new piece must meet on `end` of `piece`. */
export function buildPointAt(piece: SnapshotPiece, end: BuildEnd): BuildPoint {
  const def = PIECES[piece.pieceType];
  if (end === 'before')
    return {
      end,
      x: piece.x,
      y: piece.y,
      z: piece.z,
      dir: piece.dir,
      slope: def.entrySlope,
      bank: def.entryBank,
    };
  const exit = pieceExit(def.id, piece.x, piece.y, piece.z, piece.dir);
  return { end, ...exit, slope: def.exitSlope, bank: def.exitBank };
}

/** The piece the controls select at an open end, and where it goes. */
export function resolveBuild(
  point: BuildPoint,
  choice: PieceChoice,
  rideType: RideType,
): BuildChoice | undefined {
  const shape = { hasTrack: true, slope: point.slope, bank: point.bank };
  if (point.end === 'after') {
    const piece = resolvePiece(shape, choice, rideType);
    return piece && { piece, placement: { x: point.x, y: point.y, z: point.z, dir: point.dir } };
  }
  const piece = resolvePieceBefore(shape, choice, rideType);
  if (!piece) return undefined;
  const dir = (point.dir - piece.headingDelta) & 3;
  const [dx, dy] = rotateTile(piece.dx, piece.dy, dir);
  return { piece, placement: { x: point.x - dx, y: point.y - dy, z: point.z - piece.dz, dir } };
}
