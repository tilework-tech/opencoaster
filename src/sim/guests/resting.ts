import type { World } from '../core/world';
import { TILE_UNITS } from '../core/constants';
import { GUEST_UPDATE_STRIDE, GuestState, HEADING_NONE } from './guest-store';
import { claimSeat, releaseSeat, seatEdge, seatPosition, usableBenchEdges } from './benches';

/** Energy at or below which a guest wants to sit; the same line as the "I'm tired" thought. */
export const REST_ENERGY = 70;
/** Nausea at or above which a guest wants to sit. */
export const REST_NAUSEA = 128;
/** Furthest a guest looks for a bench, in tiles. */
export const BENCH_SEEK_RADIUS = 8;
/** Ticks before a guest that found no bench, or a full one, looks again. */
export const BENCH_RETRY_TICKS = 1536;
/** Ticks before a guest that has just rested looks for another bench. */
export const REST_COOLDOWN_TICKS = 2048;

const ENERGY_MAX = 128;
const NEED_PERIOD_TICKS = 128;
/** Energy a sitting guest regains each need period. */
const SIT_ENERGY_PER_PERIOD = 4;
/** Nausea a sitting guest loses each need period, on top of the ordinary decay. */
const SIT_NAUSEA_PER_PERIOD = 6;
/** Total nausea lost per need period while sitting, ordinary decay included. */
const SIT_NAUSEA_DROP = SIT_NAUSEA_PER_PERIOD + 2;
/** Nausea a guest is content to stand up at. */
const NAUSEA_SETTLED = 64;
const MIN_SIT_TICKS = 400;
const MAX_SIT_TICKS = 2400;
const STEP_UNITS = 12;

export function wantsRest(world: World, slot: number): boolean {
  const g = world.guests.cols;
  return g.energy[slot]! <= REST_ENERGY || g.nausea[slot]! >= REST_NAUSEA;
}

/**
 * How long a guest sits: the time its energy takes to come back, as the reference game scales it
 * (a less rested guest sits longer), or for a nauseous guest the time its nausea takes to settle,
 * whichever is longer.
 */
export function sitDuration(world: World, slot: number): number {
  const g = world.guests.cols;
  const byEnergy = (ENERGY_MAX + 1 - g.energy[slot]!) * 16 + 50;
  const byNausea =
    g.nausea[slot]! > NAUSEA_SETTLED
      ? Math.ceil((g.nausea[slot]! - NAUSEA_SETTLED) / SIT_NAUSEA_DROP) * NEED_PERIOD_TICKS
      : 0;
  return Math.max(MIN_SIT_TICKS, Math.min(MAX_SIT_TICKS, Math.max(byEnergy, byNausea)));
}

/**
 * Takes a free seat on the bench at `tile` and starts the guest walking to it. Returns false when
 * every seat there is taken or the bench is unusable.
 */
export function beginSitting(world: World, slot: number, tile: number): boolean {
  const g = world.guests.cols;
  const code = claimSeat(world, tile, world.guests.slotToId[slot]!);
  if (code === 0) return false;
  g.state[slot] = GuestState.Sitting;
  g.seat[slot] = code;
  g.benchGoal[slot] = 0;
  g.targetRide[slot] = -1;
  g.activityTicks[slot] = sitDuration(world, slot);
  return true;
}

const scratch = { x: 0, y: 0 };

/** Steps toward a world point; true once the guest stands on it. Heading follows the longer axis. */
function moveToward(world: World, slot: number, x: number, y: number): boolean {
  const g = world.guests.cols;
  const dx = x - g.x[slot]!;
  const dy = y - g.y[slot]!;
  if (dx === 0 && dy === 0) return true;
  g.heading[slot] = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
  g.x[slot] += Math.max(-STEP_UNITS, Math.min(STEP_UNITS, dx));
  g.y[slot] += Math.max(-STEP_UNITS, Math.min(STEP_UNITS, dy));
  return g.x[slot] === x && g.y[slot] === y;
}

/** True when the guest sits on its seat, as opposed to walking to it or rising from it. */
export function isSeated(world: World, slot: number): boolean {
  const g = world.guests.cols;
  const code = g.seat[slot]!;
  if (g.state[slot] !== GuestState.Sitting || code === 0) return false;
  seatPosition(g.x[slot]! >> 8, g.y[slot]! >> 8, code, scratch);
  return g.x[slot] === scratch.x && g.y[slot] === scratch.y;
}

function standUp(world: World, slot: number, cooldown: number): void {
  releaseSeat(world, slot);
  world.guests.cols.restCooldown[slot] = cooldown;
  world.guests.cols.activityTicks[slot] = 0;
}

/**
 * One update of a guest in the `Sitting` state. It walks to its seat, recovers there until its
 * time is up, then walks back to the tile centre and resumes wandering. A seat that stops being
 * usable under it (bench vandalised or removed, path piece gone, edge now joined to a path) ends
 * the rest at once.
 */
export function updateSitting(world: World, slot: number, guestTick: number): void {
  const g = world.guests.cols;
  const tileX = g.x[slot]! >> 8;
  const tileY = g.y[slot]! >> 8;
  const code = g.seat[slot]!;
  if (code !== 0) {
    const tile = world.map.index(tileX, tileY);
    if ((usableBenchEdges(world.map, tile) & (1 << seatEdge(code))) === 0) {
      standUp(world, slot, BENCH_RETRY_TICKS);
    } else {
      seatPosition(tileX, tileY, code, scratch);
      if (!moveToward(world, slot, scratch.x, scratch.y)) return;
      g.heading[slot] = (seatEdge(code) + 2) & 3;
      if (guestTick % NEED_PERIOD_TICKS === 0) {
        g.energy[slot] = Math.min(ENERGY_MAX, g.energy[slot]! + SIT_ENERGY_PER_PERIOD);
        g.nausea[slot] = Math.max(0, g.nausea[slot]! - SIT_NAUSEA_PER_PERIOD);
      }
      g.activityTicks[slot] = Math.max(0, g.activityTicks[slot]! - GUEST_UPDATE_STRIDE);
      if (g.activityTicks[slot] === 0) standUp(world, slot, REST_COOLDOWN_TICKS);
      return;
    }
  }
  const centre = TILE_UNITS >> 1;
  if (moveToward(world, slot, tileX * TILE_UNITS + centre, tileY * TILE_UNITS + centre)) {
    g.state[slot] = GuestState.Wandering;
    g.heading[slot] = HEADING_NONE;
  }
}
