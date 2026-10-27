import type { World } from '../core/world';
import { TRACK_STEPS_PER_LEVEL } from '../core/constants';
import { invalidateRideTest } from '../rides/coaster';
import { PIECES, pieceByName } from './catalog';
import { pieceExit, relinkRide } from './construction';
import { liftStalledClimbs } from './stall-repair';
import { MAX_TRACK_RIDES } from './track-store';
import { PieceFlag, PieceMode, Slope } from './track-types';

/** Pieces whose centre line changed when rises moved to RCT2's half-level grid. */
function reshaped(pieceType: number): boolean {
  const p = PIECES[pieceType];
  return p.dz !== 0 || p.entrySlope !== Slope.Flat || p.exitSlope !== Slope.Flat;
}

/** Slots of the chain starting at `anchor`, in order, at most `count` of them. */
function ringSlots(world: World, anchor: number, count: number): number[] {
  const t = world.track;
  const c = t.pieces.cols;
  const slots: number[] = [];
  for (let id = anchor; id >= 0 && slots.length < count;) {
    const slot = t.pieces.idToSlot[id];
    slots.push(slot);
    id = c.next[slot];
    if (id === anchor) break;
  }
  return slots;
}

/** Sets every piece height from the anchor onwards from the piece rises; returns pieces visited. */
function layForward(world: World, anchor: number, count: number): number {
  const c = world.track.pieces.cols;
  const slots = ringSlots(world, anchor, count);
  let z = c.z[world.track.pieces.idToSlot[anchor]];
  for (const slot of slots) {
    c.z[slot] = z;
    z += PIECES[c.pieceType[slot]].dz;
  }
  return slots.length;
}

/**
 * Pieces to lay over a straight run of flat pieces to rise by `rise` steps (negative to fall): a
 * ramp up or down, steep parts in the middle, level again at the end. Needs an even rise.
 */
function rampPieces(rise: number): number[] | null {
  if (rise === 0 || rise % 2 !== 0) return null;
  const up = rise > 0;
  const start = pieceByName(up ? 'flatToUp25' : 'flatToDown25');
  const mid = pieceByName(up ? 'up25' : 'down25');
  const end = pieceByName(up ? 'up25ToFlat' : 'down25ToFlat');
  if (!start || !mid || !end) return null;
  const middle = Math.abs(rise) / 2 - 1;
  return [start.id, ...Array<number>(middle).fill(mid.id), end.id];
}

/**
 * Closes a vertical gap of `gap` steps between the end of a circuit and its first piece without
 * moving any track: the last run of plain flat pieces long enough for a ramp becomes that ramp.
 * Returns whether such a run was found.
 */
function rampFlatRun(world: World, anchor: number, count: number, gap: number): boolean {
  const ramp = rampPieces(gap);
  const flat = pieceByName('flat');
  if (!ramp || !flat) return false;
  const c = world.track.pieces.cols;
  const slots = ringSlots(world, anchor, count);
  let run = 0;
  for (let i = slots.length - 1; i >= -1; i--) {
    const plain =
      i >= 0 && c.pieceType[slots[i]] === flat.id && c.mode[slots[i]] === PieceMode.Normal;
    if (plain) {
      run++;
      continue;
    }
    if (run >= ramp.length) {
      const first = i + 1;
      for (let k = 0; k < ramp.length; k++) c.pieceType[slots[first + k]] = ramp[k];
      return true;
    }
    run = 0;
  }
  return false;
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
    const anchorSlot = t.pieces.idToSlot[anchor];
    c.z[anchorSlot] *= TRACK_STEPS_PER_LEVEL;
    let n = layForward(world, anchor, count);
    for (const slot of ringSlots(world, anchor, count)) changed ||= reshaped(c.pieceType[slot]);
    if (t.closed[ride] !== 1) {
      let z = c.z[t.pieces.idToSlot[anchor]];
      for (let id = c.prev[t.pieces.idToSlot[anchor]]; id >= 0 && n < count; n++) {
        const slot = t.pieces.idToSlot[id];
        z -= PIECES[c.pieceType[slot]].dz;
        c.z[slot] = z;
        changed ||= reshaped(c.pieceType[slot]);
        id = c.prev[slot];
      }
    } else {
      const hs = t.pieces.idToSlot[anchor];
      const ts = t.pieces.idToSlot[c.prev[hs]];
      let exit = pieceExit(c.pieceType[ts], c.x[ts], c.y[ts], c.z[ts], c.dir[ts]);
      if (exit.z !== c.z[hs] && rampFlatRun(world, anchor, count, c.z[hs] - exit.z)) {
        layForward(world, anchor, count);
        exit = pieceExit(c.pieceType[ts], c.x[ts], c.y[ts], c.z[ts], c.dir[ts]);
        changed = true;
      }
      if (exit.z !== c.z[hs]) {
        t.head[ride] = anchor;
        t.tail[ride] = c.prev[hs];
        c.next[ts] = -1;
        c.prev[hs] = -1;
        t.closed[ride] = 0;
      }
    }
    relinkRide(world, ride);
    if (changed && world.rides.isAlive(ride)) {
      invalidateRideTest(world, ride);
      if (t.closed[ride] === 1) liftStalledClimbs(world, ride);
    }
  }
}
