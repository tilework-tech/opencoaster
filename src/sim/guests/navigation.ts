import type { World } from '../core/world';
import { DEFAULT_GUEST_OPTS, lastSearchOutcome, SearchOutcome } from '../pathfinding';
import type { NavOptions } from '../pathfinding';
import { GuestThought, recordThought } from './guest-store';

/** Junction choices a guest may make blind, without getting closer to its goal, before it is lost. */
export const LOST_AFTER_CHOICES = 12;
/** How long a lost guest wanders (and looks for a kiosk) before it picks a destination again. */
export const LOST_WANDER_TICKS = 2400;
/** Price of a park map at an information kiosk, in cents. */
export const MAP_PRICE = 60;
/** Extra junction budget a park map gives the pathfinder. */
export const MAP_JUNCTION_BONUS = 16;
/** A guest with a map tolerates this many times more blind tiles before it is lost. */
export const MAP_LOST_FACTOR = 2;
/** A leaving guest that cannot find the exit loses happiness this often (guest updates). */
export const EXIT_PENALTY_TICKS = 11520;
export const EXIT_HAPPINESS_LOSS = 30;

function tileGap(world: World, a: number, b: number): number {
  const w = world.map.width;
  return Math.abs((a % w) - (b % w)) + Math.abs(((a / w) | 0) - ((b / w) | 0));
}

/** Pathfinder budget for this guest: a map buys a longer lookahead. */
export function applyGuestBudget(world: World, slot: number, nav: NavOptions): void {
  const mapped = world.guests.cols.hasMap[slot] === 1;
  nav.maxJunctions = DEFAULT_GUEST_OPTS.maxJunctions + (mapped ? MAP_JUNCTION_BONUS : 0);
}

/** True while the guest is lost and should wander instead of heading anywhere. */
export function isLost(world: World, slot: number): boolean {
  return world.guests.cols.lostTicks[slot] > 0;
}

export function tickLost(world: World, slot: number, ticks: number): void {
  const g = world.guests.cols;
  if (g.lostTicks[slot] > 0) g.lostTicks[slot] = Math.max(0, g.lostTicks[slot] - ticks);
}

/** Marks the guest lost: it wanders for a while and thinks so. */
export function becomeLost(world: World, slot: number): void {
  const g = world.guests.cols;
  g.lostTicks[slot] = LOST_WANDER_TICKS;
  g.navGoal[slot] = 0;
  recordThought(world, slot, GuestThought.Lost);
}

/**
 * Called after each goal-directed pathfinder step. A choice that saw the goal, or brought the
 * guest closer to it than it has been, is progress; forced steps count for nothing; `LOST_AFTER_CHOICES` blind decisions
 * without progress make the guest lost. Returns true if the guest just became lost.
 */
export function noteNavigation(world: World, slot: number, tile: number, goal: number): boolean {
  const g = world.guests.cols;
  const outcome = lastSearchOutcome();
  if (outcome === SearchOutcome.Unsearched) return false;
  const gap = tileGap(world, tile, goal);
  if (g.navGoal[slot] !== goal + 1) {
    g.navGoal[slot] = goal + 1;
    g.navGap[slot] = gap;
    g.navSteps[slot] = 0;
    return false;
  }
  if (outcome === SearchOutcome.Seen || gap < g.navGap[slot]) {
    g.navGap[slot] = Math.min(g.navGap[slot], gap);
    g.navSteps[slot] = 0;
    return false;
  }
  g.navSteps[slot]++;
  const limit = g.hasMap[slot] === 1 ? LOST_AFTER_CHOICES * MAP_LOST_FACTOR : LOST_AFTER_CHOICES;
  if (g.navSteps[slot] < limit) return false;
  becomeLost(world, slot);
  return true;
}
