import type { World } from '../core/world';
import { TILE_UNITS } from '../core/constants';

export const enum GuestState {
  Wandering = 0,
  Queuing = 1,
  Riding = 2,
  Leaving = 3,
  /** Using a stall or toilets at its entrance tile. */
  Shopping = 4,
  /** At the head of a ride queue, counted in the ride's `queueLength`. */
  Waiting = 5,
}

/** `heading` value while a guest has not yet moved (or has just been placed). */
export const HEADING_NONE = 4;

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
  Lost = 9,
  Scenery = 10,
  VeryClean = 11,
  QueuingForAges = 12,
  Tired = 13,
  OutOfMoney = 14,
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
  /** Last walking direction (0..3, see pathfinding/directions) or HEADING_NONE. */
  heading: Uint8Array,
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
  /** Smallest tile gap to the current destination's entrance; a closer step refreshes patience. */
  approachGap: Uint16Array,
  /** Tile (plus one; 0 = none) the guest's progress toward is being tracked for. */
  navGoal: Int32Array,
  /** Smallest tile gap to `navGoal` seen while the pathfinder could not see the goal. */
  navGap: Uint16Array,
  /** Tiles walked blind without getting closer to `navGoal`. */
  navSteps: Uint16Array,
  /** Ticks left of being lost: the guest wanders and looks for an information kiosk. */
  lostTicks: Uint16Array,
  /** 1 once the guest owns a park map. */
  hasMap: Uint8Array,
  /** Total ticks spent in the park. */
  visitTicks: Uint32Array,
  ridesTaken: Uint16Array,
  lastRide: Int32Array,
  /** Cursor for the next write in the guest's recent ride history. */
  rideHistoryCursor: Uint8Array,
  rideHistory0: Int32Array,
  rideHistory1: Int32Array,
  rideHistory2: Int32Array,
  rideHistory3: Int32Array,
  /** Ticks since this guest last saw litter or vomit. */
  litterMemory: Uint16Array,
  /** Ticks remaining before this guest stops being angry. */
  angriness: Uint16Array,
  /** `VoucherKind` of the voucher the guest carries; zero when it carries none. */
  voucherKind: Uint8Array,
  /** Ride or stall the carried voucher names, or -1. */
  voucherTarget: Int32Array,
  /** Position in the ride's queue order: the ride's serial when the guest joined its line. */
  queueSeq: Uint32Array,
  happinessTarget: Uint8Array,
} as const;

export function recordRideHistory(w: World, slot: number, rideId: number): void {
  const guests = w.guests.cols;
  const cursor = guests.rideHistoryCursor[slot] & 3;
  if (cursor === 0) guests.rideHistory0[slot] = rideId;
  else if (cursor === 1) guests.rideHistory1[slot] = rideId;
  else if (cursor === 2) guests.rideHistory2[slot] = rideId;
  else guests.rideHistory3[slot] = rideId;
  guests.rideHistoryCursor[slot] = (cursor + 1) & 3;
}

/** Records a thought as the newest; a thought already in the list moves to the front instead of repeating. */
export function recordThought(w: World, slot: number, thought: GuestThought): void {
  if (thought === GuestThought.None) return;
  const g = w.guests.cols;
  const ring = [g.thought0, g.thought1, g.thought2, g.thought3];
  const cursor = g.thoughtCursor[slot] & 3;
  const kept: number[] = [];
  for (let i = 0; i < 4; i++) {
    const value = ring[(cursor + i) & 3][slot];
    if (value !== GuestThought.None && value !== thought) kept.push(value);
  }
  kept.push(thought);
  while (kept.length > 4) kept.shift();
  for (let i = 0; i < 4; i++) ring[i][slot] = i < kept.length ? kept[i] : GuestThought.None;
  g.thoughtCursor[slot] = kept.length & 3;
}

export function spawnGuest(w: World): boolean {
  const g = w.guests;
  const slot = g.spawn();
  if (slot < 0) return false;
  w.umbrellas[g.slotToId[slot]] = 0;
  let tx = w.park.entranceX;
  let ty = w.park.entranceY;
  if (tx < 0) {
    tx = w.rng.int(w.map.width);
    ty = w.rng.int(w.map.height);
  }
  g.cols.x[slot] = tx * TILE_UNITS + (TILE_UNITS >> 1);
  g.cols.y[slot] = ty * TILE_UNITS + (TILE_UNITS >> 1);
  g.cols.z[slot] = w.map.heightAt(g.cols.x[slot], g.cols.y[slot]);
  g.cols.targetX[slot] = tx;
  g.cols.targetY[slot] = ty;
  g.cols.targetRide[slot] = -1;
  g.cols.state[slot] = GuestState.Wandering;
  g.cols.heading[slot] = HEADING_NONE;
  g.cols.tint[slot] = w.rng.int(8);
  g.cols.happiness[slot] = 96 + w.rng.int(96);
  g.cols.happinessTarget[slot] = g.cols.happiness[slot];
  g.cols.energy[slot] = 65 + w.rng.int(64);
  g.cols.hunger[slot] = 128 + w.rng.int(128);
  g.cols.thirst[slot] = 128 + w.rng.int(128);
  const toleranceRoll = w.rng.int(8);
  g.cols.nauseaTolerance[slot] =
    toleranceRoll === 0 ? 0 : toleranceRoll < 3 ? 1 : toleranceRoll < 6 ? 2 : 3;
  g.cols.preferredIntensity[slot] = 48 + w.rng.int(176);
  g.cols.cash[slot] = 5000 + w.rng.int(5000);
  g.cols.patience[slot] = 600;
  g.cols.visitTicks[slot] = 0;
  g.cols.ridesTaken[slot] = 0;
  g.cols.lastRide[slot] = -1;
  g.cols.voucherKind[slot] = 0;
  g.cols.voucherTarget[slot] = -1;
  return true;
}
