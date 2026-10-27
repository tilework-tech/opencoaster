import type { World } from '../core/world';
import { TRACK_STEPS_PER_LEVEL } from '../core/constants';
import { applyRideCommand } from '../rides/ride-commands';
import { RideState } from '../rides/ride-store';
import { PIECES } from './catalog';
import { pieceExit, relinkRide } from './construction';
import { MAX_TRACK_RIDES } from './track-store';

/**
 * Converts track stored in whole land levels (saves before version 26) to track steps of half a
 * level, re-laying each chain from its head with the current piece rises. The head piece keeps its
 * world height; later pieces follow the RCT2 rises, so slopes are half as steep as before. Train
 * positions scale with the new circuit length. A circuit whose last piece no longer meets its first
 * reopens, and its ride closes. Returns the ids of those rides.
 */
export function migrateTrackHeights(world: World): number[] {
  const t = world.track;
  const c = t.pieces.cols;
  const reopened: number[] = [];
  for (let ride = 0; ride < MAX_TRACK_RIDES; ride++) {
    if (t.head[ride] < 0 || t.count[ride] === 0 || !t.pieces.isAlive(t.head[ride])) continue;
    const oldLength = t.length[ride];
    let id = t.head[ride];
    let z = c.z[t.pieces.idToSlot[id]] * TRACK_STEPS_PER_LEVEL;
    let tail = id;
    do {
      const slot = t.pieces.idToSlot[id];
      c.z[slot] = z;
      z += PIECES[c.pieceType[slot]].dz;
      tail = id;
      id = c.next[slot];
    } while (id >= 0 && id !== t.head[ride]);
    if (t.closed[ride] === 1) {
      const hs = t.pieces.idToSlot[t.head[ride]];
      const ts = t.pieces.idToSlot[tail];
      const exit = pieceExit(c.pieceType[ts], c.x[ts], c.y[ts], c.z[ts], c.dir[ts]);
      if (exit.z !== c.z[hs]) {
        c.next[ts] = -1;
        c.prev[hs] = -1;
        t.closed[ride] = 0;
        reopened.push(ride);
      }
    }
    relinkRide(world, ride);
    const newLength = t.length[ride];
    const v = world.vehicles.cols;
    for (let slot = 0; slot < world.vehicles.count; slot++) {
      if (v.rideId[slot] !== ride || oldLength <= 0) continue;
      v.trackPos[slot] = Math.floor((v.trackPos[slot] / oldLength) * newLength);
    }
  }
  for (const ride of reopened) {
    if (!world.rides.isAlive(ride)) continue;
    const state = world.rides.cols.state[world.rides.idToSlot[ride]];
    if (state === RideState.Open || state === RideState.Testing)
      applyRideCommand(world, { type: 'setRideStatus', rideId: ride, status: 'close' });
  }
  return reopened;
}
