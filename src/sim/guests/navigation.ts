import type { World } from '../core/world';
import {
  GUEST_JUNCTIONS,
  GUEST_LEAVING_JUNCTIONS,
  GUEST_LEAVING_LOST_JUNCTIONS,
  GUEST_MAP_JUNCTIONS,
  isReachable,
} from '../pathfinding';
import type { NavOptions } from '../pathfinding';
import { GuestState, GuestThought, recordThought } from './guest-store';
import { parkEntranceTile } from './park';

/** Tiles a guest searches for a ride it has picked before it gives up on it. */
export const RIDE_GOAL_COUNTDOWN = 200;
/** Tiles a guest looks for the exit before its first "can't find the exit" thought. */
export const LEAVING_COUNTDOWN = 254;
/** The exit countdown restarts here each time it runs out; below it a leaving guest counts as lost. */
export const EXIT_RETRY_COUNTDOWN = 90;
/** Ride-search countdown values at which the guest thinks it cannot find its ride. */
const CANT_FIND_RIDE_FIRST = 60;
const CANT_FIND_RIDE_SECOND = 30;
/** Happiness target lost with each lost, can't-find-ride or can't-find-exit thought. */
export const CANT_FIND_PENALTY = 30;
/** Tile centres a guest walks with nowhere to be before it thinks it is lost (two per lost-clock step to 254). */
export const LOST_WALK_LIMIT = 508;
/** Tile centres the wander counter returns to after a lost thought, so the next comes 48 tiles later. */
export const WANDER_RESET = 460;
/** Rides the park needs before guests can feel lost in it. */
const LOST_MIN_RIDES = 2;
/** How long a guest that has lost its way wanders (and looks for a kiosk) before it picks a destination again. */
export const LOST_WANDER_TICKS = 2400;
/** Price of a park map at an information kiosk, in cents. */
export const MAP_PRICE = 60;
/** Tile centres a guest with no reachable destination may visit cut off from the gate before it leaves. */
export const STRANDED_LEAVE_VISITS = 40;

/** Pathfinder budget for this guest: a map, and the search for the exit, buy a longer lookahead. */
export function applyGuestBudget(world: World, slot: number, nav: NavOptions): void {
  const g = world.guests.cols;
  if (g.state[slot] === GuestState.Leaving) {
    nav.maxJunctions =
      g.lostCountdown[slot] < EXIT_RETRY_COUNTDOWN
        ? GUEST_LEAVING_LOST_JUNCTIONS
        : GUEST_LEAVING_JUNCTIONS;
  } else {
    nav.maxJunctions = g.hasMap[slot] === 1 ? GUEST_MAP_JUNCTIONS : GUEST_JUNCTIONS;
  }
}

/** True while the guest has lost its way and should wander (and look for a kiosk) instead of heading anywhere. */
export function isLost(world: World, slot: number): boolean {
  return world.guests.cols.lostTicks[slot] > 0;
}

export function tickLost(world: World, slot: number, ticks: number): void {
  const g = world.guests.cols;
  if (g.lostTicks[slot] > 0) g.lostTicks[slot] = Math.max(0, g.lostTicks[slot] - ticks);
}

function loseHappiness(world: World, slot: number): void {
  const g = world.guests.cols;
  g.happinessTarget[slot] = Math.max(0, g.happinessTarget[slot] - CANT_FIND_PENALTY);
}

/** Marks the guest lost: it wanders for a while, and its junction memory is forgotten. */
function startLostWander(world: World, slot: number): void {
  const g = world.guests.cols;
  g.lostTicks[slot] = LOST_WANDER_TICKS;
  g.navGoal[slot] = 0;
}

/** The guest has somewhere to be again: the walk since it last did stops counting toward feeling lost. */
export function resetWandering(world: World, slot: number): void {
  world.guests.cols.wanderSteps[slot] = 0;
}

/**
 * Called when a guest reaches a tile centre while heading for a ride. The ride search has
 * `RIDE_GOAL_COUNTDOWN` tiles; the guest complains at 60 and 30 left (losing happiness each time)
 * and drops the ride when it runs out. Returns true when the guest has just given up.
 */
export function checkCantFindRide(world: World, slot: number): boolean {
  const g = world.guests.cols;
  if (g.targetRide[slot] < 0) return false;
  const left = g.lostCountdown[slot];
  if (left === 0) return false;
  if (left === CANT_FIND_RIDE_FIRST || left === CANT_FIND_RIDE_SECOND) {
    recordThought(world, slot, GuestThought.CantFindRide);
    loseHappiness(world, slot);
    if (left === CANT_FIND_RIDE_FIRST) startLostWander(world, slot);
  }
  g.lostCountdown[slot] = left - 1;
  return left === 1;
}

/**
 * Called when a leaving guest reaches a tile centre. After `LEAVING_COUNTDOWN` tiles without
 * reaching the gate it thinks it cannot find the exit, and again every `EXIT_RETRY_COUNTDOWN`
 * tiles for as long as it stays in the park, losing happiness each time.
 */
export function checkCantFindExit(world: World, slot: number): void {
  const g = world.guests.cols;
  if (g.state[slot] !== GuestState.Leaving) return;
  const left = g.lostCountdown[slot];
  if (left === 1) {
    recordThought(world, slot, GuestThought.CantFindExit);
    loseHappiness(world, slot);
  }
  g.lostCountdown[slot] = left <= 1 ? EXIT_RETRY_COUNTDOWN : left - 1;
}

/**
 * Called at every tile centre. A guest that walks `LOST_WALK_LIMIT` tiles without a ride, stall
 * or other destination thinks it is lost, and again every 48 tiles until it does something else.
 */
export function checkWanderedLost(world: World, slot: number): void {
  if (world.rides.count < LOST_MIN_RIDES) return;
  const g = world.guests.cols;
  const walked = g.wanderSteps[slot] + 1;
  if (walked < LOST_WALK_LIMIT) {
    g.wanderSteps[slot] = walked;
    return;
  }
  g.wanderSteps[slot] = WANDER_RESET;
  recordThought(world, slot, GuestThought.Lost);
  loseHappiness(world, slot);
  startLostWander(world, slot);
}

/**
 * Called at a tile centre where a guest has no destination it can walk to. A guest with no
 * footpath to the gate thinks it is lost and wanders; after `STRANDED_LEAVE_VISITS` such visits
 * it leaves the park. Returns true when the guest should be despawned.
 */
export function noteStranded(world: World, slot: number, tile: number): boolean {
  const g = world.guests.cols;
  const gate = parkEntranceTile(world);
  if (gate < 0 || isReachable(world, world.map.walkNode(tile, g.z[slot]), gate)) {
    g.navSteps[slot] = 0;
    return false;
  }
  if (!isLost(world, slot)) {
    recordThought(world, slot, GuestThought.Lost);
    startLostWander(world, slot);
  }
  g.navSteps[slot]++;
  return g.navSteps[slot] >= STRANDED_LEAVE_VISITS;
}
