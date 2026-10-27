import type { World } from '../core/world';
import { TRACK_STEPS_PER_LEVEL } from '../core/constants';
import { invalidateRideTest } from '../rides/coaster';
import { PIECES } from './catalog';
import { pieceExit, relinkRide } from './construction';
import { MAX_TRACK_RIDES } from './track-store';
import { PieceFlag, Slope } from './track-types';

/** Pieces whose centre line changed when rises moved to RCT2's half-level grid. */
function reshaped(pieceType: number): boolean {
  const p = PIECES[pieceType];
  return p.dz !== 0 || p.entrySlope !== Slope.Flat || p.exitSlope !== Slope.Flat;
}

/**
 * Converts track stored in whole land levels (saves before version 26) to track steps of half a
 * level. Each chain is re-laid with the current piece rises from its first station (or its head
 * when it has none), which keeps its world height; slopes elsewhere become half as steep, so raised
 * sections end lower than before and are not re-checked against terrain or other track. A ride
 * with any reshaped piece closes, loses its trains and must be tested again, since its stored test
 * describes the old layout. A circuit whose last piece no longer meets its first reopens.
 */
export function migrateTrackHeights(world: World): void {
  const t = world.track;
  const c = t.pieces.cols;
  for (let ride = 0; ride < MAX_TRACK_RIDES; ride++) {
    if (t.head[ride] < 0 || t.count[ride] === 0 || !t.pieces.isAlive(t.head[ride])) continue;
    const count = t.count[ride];
    let anchor = t.head[ride];
    for (let id = t.head[ride], n = 0; id >= 0 && n < count; n++) {
      const slot = t.pieces.idToSlot[id];
      if (PIECES[c.pieceType[slot]].flags & PieceFlag.Station) {
        anchor = id;
        break;
      }
      id = c.next[slot];
    }
    let changed = false;
    let id = anchor;
    let z = c.z[t.pieces.idToSlot[anchor]] * TRACK_STEPS_PER_LEVEL;
    let n = 0;
    do {
      const slot = t.pieces.idToSlot[id];
      c.z[slot] = z;
      z += PIECES[c.pieceType[slot]].dz;
      changed ||= reshaped(c.pieceType[slot]);
      id = c.next[slot];
    } while (id >= 0 && id !== anchor && ++n < count);
    if (t.closed[ride] !== 1) {
      z = c.z[t.pieces.idToSlot[anchor]];
      for (id = c.prev[t.pieces.idToSlot[anchor]]; id >= 0 && n < count; n++) {
        const slot = t.pieces.idToSlot[id];
        z -= PIECES[c.pieceType[slot]].dz;
        c.z[slot] = z;
        changed ||= reshaped(c.pieceType[slot]);
        id = c.prev[slot];
      }
    } else {
      const hs = t.pieces.idToSlot[anchor];
      const ts = t.pieces.idToSlot[c.prev[hs]];
      const exit = pieceExit(c.pieceType[ts], c.x[ts], c.y[ts], c.z[ts], c.dir[ts]);
      if (exit.z !== c.z[hs]) {
        t.head[ride] = anchor;
        t.tail[ride] = c.prev[hs];
        c.next[ts] = -1;
        c.prev[hs] = -1;
        t.closed[ride] = 0;
      }
    }
    relinkRide(world, ride);
    if (changed && world.rides.isAlive(ride)) invalidateRideTest(world, ride);
  }
}
