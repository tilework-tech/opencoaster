import type { TrackPieceDef } from '../../../src/sim/track/track-types';
import type { Mesh } from '../mesh';
export type CarPitch = 'flat' | 'up25' | 'up60' | 'down25' | 'down60';

/** Track and vehicle art for one transport ride family, keyed by its sprite style name. */
export interface TransportStyle {
  /** Atlas path segment: `track/<style>/...` and `vehicles/<style>/...`. */
  style: string;
  /** Track geometry of one catalog piece in height levels, entering along +x at the tile's west edge. */
  track: (piece: TrackPieceDef) => Mesh;
  /** One vehicle at the given heading (eighths of a turn) and track pitch, in height levels. */
  car: (heading: number, pitch: CarPitch) => Mesh;
}
