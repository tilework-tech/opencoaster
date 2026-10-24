import { EntityStore } from '../core/entity-store';
import type { TrackResult } from './track-types';
import type { TrackPath } from './track-path';

/** Hard limits on the track store. */
export const MAX_TRACK_PIECES = 16384;
export const MAX_TRACK_RIDES = 256;
export const MAX_PIECES_PER_RIDE = 2048;
/** Highest entry height (in height levels) a piece may reach; applies to the whole piece. */
export const MAX_TRACK_LEVEL = 96;

/** One row per placed piece. Links hold stable entity ids (-1 = none), never slots. */
export const TRACK_SCHEMA = {
  rideId: Uint16Array,
  pieceType: Uint16Array,
  /** Origin tile and entry height level. */
  x: Int16Array,
  y: Int16Array,
  z: Int16Array,
  dir: Uint8Array,
  mode: Uint8Array,
  prev: Int32Array,
  next: Int32Array,
  /** Arclength from the ride's head piece to this piece's entry, in TILE_UNITS. */
  startS: Int32Array,
} as const;

/** All track state in the world: placed pieces plus a per-ride chain summary. */
export class TrackState {
  readonly pieces = new EntityStore(TRACK_SCHEMA, MAX_TRACK_PIECES);
  /** Per-ride chain ends (piece ids, -1 = none). In a closed circuit `tail.next === head`. */
  readonly head = new Int32Array(MAX_TRACK_RIDES).fill(-1);
  readonly tail = new Int32Array(MAX_TRACK_RIDES).fill(-1);
  readonly count = new Uint16Array(MAX_TRACK_RIDES);
  readonly closed = new Uint8Array(MAX_TRACK_RIDES);
  /** Total centre-line length in TILE_UNITS. */
  readonly length = new Int32Array(MAX_TRACK_RIDES);
  /** Bumped on every edit; invalidates cached paths. */
  readonly version = new Int32Array(MAX_TRACK_RIDES);
  /** Result and piece id of the most recently applied command. */
  lastResult: TrackResult = 0;
  lastPiece = -1;
  /** Derived polylines, rebuilt on demand from the pieces; not part of the hashed state. */
  readonly paths: (TrackPath | null)[] = new Array<TrackPath | null>(MAX_TRACK_RIDES).fill(null);

  /** Per-ride tables in a fixed order, for hashing and save/load. */
  rideTables(): ArrayBufferView[] {
    return [this.head, this.tail, this.count, this.closed, this.length, this.version];
  }
}
