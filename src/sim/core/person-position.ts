import { TILE_UNITS } from './constants';
import type { World } from './world';
import { OWNED } from '../map/tile-map';
import { GuestState, HEADING_NONE } from '../guests/guest-store';

export type PersonKind = 'guest' | 'staff';

/** Moves an eligible person to a path or dry owned tile. Coordinates are map tile indices. */
export function setPersonPosition(
  world: World,
  person: PersonKind,
  personId: number,
  tileX: number,
  tileY: number,
): boolean {
  const { map } = world;
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY) || !map.inBounds(tileX, tileY))
    return false;
  const tile = map.index(tileX, tileY);
  if (!map.isWalkable(tile) && (map.ownership[tile]! & OWNED) === 0) return false;
  if (map.waterLevel[tile]! > map.heights[tile]!) return false;

  const x = tileX * TILE_UNITS + (TILE_UNITS >> 1);
  const y = tileY * TILE_UNITS + (TILE_UNITS >> 1);
  const z = map.heightAt(x, y);

  if (person === 'guest') {
    const slot = world.guests.idToSlot[personId] ?? -1;
    if (slot < 0) return false;
    const guests = world.guests.cols;
    const state = guests.state[slot];
    if (state === GuestState.Queuing || state === GuestState.Waiting || state === GuestState.Riding)
      return false;
    guests.x[slot] = x;
    guests.y[slot] = y;
    guests.z[slot] = z;
    guests.targetX[slot] = tileX;
    guests.targetY[slot] = tileY;
    guests.targetRide[slot] = -1;
    guests.state[slot] = GuestState.Wandering;
    guests.heading[slot] = HEADING_NONE;
    guests.wanderSteps[slot] = 0;
    guests.lostCountdown[slot] = 0;
    guests.navGoal[slot] = 0;
    guests.pathCursor[slot] = 0;
    guests.pathHistory0[slot] = 0;
    guests.pathHistory1[slot] = 0;
    guests.pathHistory2[slot] = 0;
    guests.pathHistory3[slot] = 0;
    guests.navSteps[slot] = 0;
    guests.lostTicks[slot] = 0;
    return true;
  }

  const slot = world.staff.idToSlot[personId] ?? -1;
  if (slot < 0) return false;
  const staff = world.staff.cols;
  staff.x[slot] = x;
  staff.y[slot] = y;
  staff.z[slot] = z;
  staff.targetX[slot] = tileX;
  staff.targetY[slot] = tileY;
  return true;
}
