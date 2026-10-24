import type { World } from '../core/world';
import { TILE_UNITS, Z_STEP } from '../core/constants';

export const enum GuestState {
  Wandering = 0,
  Queuing = 1,
  Riding = 2,
  Leaving = 3,
}

/** Guest columns. Positions are fixed-point (TILE_UNITS per tile). Needs/stats are 0..255. */
export const GUEST_SCHEMA = {
  x: Int32Array,
  y: Int32Array,
  z: Int32Array,
  targetX: Int16Array,
  targetY: Int16Array,
  state: Uint8Array,
  tint: Uint8Array,
  happiness: Uint8Array,
  hunger: Uint8Array,
  thirst: Uint8Array,
  nausea: Uint8Array,
  energy: Uint8Array,
  cash: Int32Array,
} as const;

export function spawnGuest(w: World): boolean {
  const g = w.guests;
  const slot = g.spawn();
  if (slot < 0) return false;
  const tx = w.rng.int(w.map.width);
  const ty = w.rng.int(w.map.height);
  g.cols.x[slot] = tx * TILE_UNITS + (TILE_UNITS >> 1);
  g.cols.y[slot] = ty * TILE_UNITS + (TILE_UNITS >> 1);
  g.cols.z[slot] = w.map.heights[w.map.index(tx, ty)] * Z_STEP;
  g.cols.targetX[slot] = tx;
  g.cols.targetY[slot] = ty;
  g.cols.state[slot] = GuestState.Wandering;
  g.cols.tint[slot] = w.rng.int(8);
  g.cols.happiness[slot] = 128;
  g.cols.energy[slot] = 255;
  g.cols.cash[slot] = 5000 + w.rng.int(5000);
  return true;
}
