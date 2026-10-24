import type { World } from '../core/world';
import { TILE_UNITS, Z_STEP } from '../core/constants';

export const enum GuestState {
  Wandering = 0,
  Queuing = 1,
  Riding = 2,
  Leaving = 3,
}

export const enum GuestThought {
  None = 0,
  Hungry = 1,
  Thirsty = 2,
  NeedsToilet = 3,
  TooNauseous = 4,
  TooIntense = 5,
  RideEnjoyed = 6,
  QueueTooLong = 7,
  Leaving = 8,
}

/** Guest columns. Needs and preferences use 0..255; money is integer cents. */
export const GUEST_SCHEMA = {
  x: Int32Array,
  y: Int32Array,
  z: Int32Array,
  targetX: Int16Array,
  targetY: Int16Array,
  targetRide: Int32Array,
  state: Uint8Array,
  tint: Uint8Array,
  happiness: Uint8Array,
  hunger: Uint8Array,
  thirst: Uint8Array,
  toilet: Uint8Array,
  nausea: Uint8Array,
  nauseaTolerance: Uint8Array,
  preferredIntensity: Uint8Array,
  energy: Uint8Array,
  cash: Int32Array,
  patience: Uint16Array,
  activityTicks: Uint16Array,
  thoughtCursor: Uint8Array,
  thought0: Uint8Array,
  thought1: Uint8Array,
  thought2: Uint8Array,
  thought3: Uint8Array,
} as const;

export function recordThought(w: World, slot: number, thought: GuestThought): void {
  if (thought === GuestThought.None) return;
  const g = w.guests.cols;
  const cursor = g.thoughtCursor[slot] & 3;
  if (cursor === 0) g.thought0[slot] = thought;
  else if (cursor === 1) g.thought1[slot] = thought;
  else if (cursor === 2) g.thought2[slot] = thought;
  else g.thought3[slot] = thought;
  g.thoughtCursor[slot] = (cursor + 1) & 3;
}

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
  g.cols.targetRide[slot] = -1;
  g.cols.state[slot] = GuestState.Wandering;
  g.cols.tint[slot] = w.rng.int(8);
  g.cols.happiness[slot] = 96 + w.rng.int(96);
  g.cols.energy[slot] = 220 + w.rng.int(36);
  g.cols.hunger[slot] = w.rng.int(64);
  g.cols.thirst[slot] = w.rng.int(64);
  g.cols.nauseaTolerance[slot] = 96 + w.rng.int(160);
  g.cols.preferredIntensity[slot] = 48 + w.rng.int(176);
  g.cols.cash[slot] = 5000 + w.rng.int(5000);
  g.cols.patience[slot] = 600;
  return true;
}
