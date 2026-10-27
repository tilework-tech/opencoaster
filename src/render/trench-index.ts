import { TRACK_Z_STEP, TILE_UNITS } from '../sim/core/constants';
import { trenchTiles } from '../sim/track/trench';
import type { TrackPiecePlacement, TrenchTile } from '../sim/track/trench';
import { SNAPSHOT_STRIDE } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import type { MapData } from './renderer';

/**
 * The trench tiles of the placed track, rebuilt only when the track layer or the map changes.
 * `signature` changes whenever the set of trench tiles might have, for renderer caches.
 */
export class TrenchIndex {
  tiles: ReadonlyMap<number, TrenchTile> = new Map();
  signature = 0;
  private map: MapData | null = null;
  private hash = -1;
  private count = -1;

  clear(): void {
    if (this.tiles.size === 0 && this.hash === -1) return;
    this.tiles = new Map();
    this.hash = -1;
    this.count = -1;
    this.map = null;
    this.signature++;
  }

  update(snapshot: Snapshot, map: MapData): void {
    const tracks = snapshot.tracks;
    const data = tracks.data;
    let hash = 0;
    for (let i = 0, o = 0; i < tracks.count; i++, o += SNAPSHOT_STRIDE)
      hash =
        (Math.imul(hash, 31) + data[o] + data[o + 1] * 3 + data[o + 2] * 7 + data[o + 3] * 13) | 0;
    if (hash === this.hash && tracks.count === this.count && map === this.map) return;
    this.hash = hash;
    this.count = tracks.count;
    this.map = map;
    this.signature++;
    this.tiles = trenchTiles(map, placements(snapshot));
  }
}

function* placements(snapshot: Snapshot): Generator<TrackPiecePlacement> {
  const tracks = snapshot.tracks;
  for (let i = 0, o = 0; i < tracks.count; i++, o += SNAPSHOT_STRIDE) {
    const word = tracks.data[o + 3];
    yield {
      pieceType: word & 0xff,
      dir: (word >> 8) & 3,
      x: Math.floor(tracks.data[o] / TILE_UNITS),
      y: Math.floor(tracks.data[o + 1] / TILE_UNITS),
      z: tracks.data[o + 2] / TRACK_Z_STEP,
    };
  }
}
