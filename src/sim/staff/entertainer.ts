import type { World } from '../core/world';
import { TILE_SHIFT, Z_STEP } from '../core/constants';
import { GuestState } from '../guests/guest-store';

/** A destination choice waves when a roll out of 65,536 is at most this: one in four. */
export const ENTERTAINER_WAVE_ROLL = 0x4000;
/** Guests within this many tiles in each axis are entertained. */
export const ENTERTAINER_RADIUS_TILES = 3;
export const WALKING_HAPPINESS_BOOST = 4;
export const QUEUING_HAPPINESS_BOOST = 3;
/** Ticks taken off a queuing guest's wait. */
export const QUEUE_WAIT_RELIEF = 200;

/**
 * Cheers the guests around the entertainer in `staffSlot`: a walking guest's happiness target
 * rises by 4, a queuing guest's by 3 and its wait shortens. Returns the number of guests affected.
 */
export function entertainNearbyGuests(world: World, staffSlot: number): number {
  const staff = world.staff.cols;
  const guests = world.guests.cols;
  const tileX = staff.x[staffSlot] >> TILE_SHIFT;
  const tileY = staff.y[staffSlot] >> TILE_SHIFT;
  let affected = 0;
  for (let slot = 0; slot < world.guests.count; slot++) {
    if (Math.abs((guests.x[slot] >> TILE_SHIFT) - tileX) > ENTERTAINER_RADIUS_TILES) continue;
    if (Math.abs((guests.y[slot] >> TILE_SHIFT) - tileY) > ENTERTAINER_RADIUS_TILES) continue;
    if (Math.abs(guests.z[slot] - staff.z[staffSlot]) > Z_STEP) continue;
    const state = guests.state[slot];
    let boost: number;
    if (state === GuestState.Wandering) boost = WALKING_HAPPINESS_BOOST;
    else if (state === GuestState.Queuing || state === GuestState.Waiting) {
      boost = QUEUING_HAPPINESS_BOOST;
      guests.patience[slot] = Math.max(0, guests.patience[slot] - QUEUE_WAIT_RELIEF);
    } else continue;
    guests.happinessTarget[slot] = Math.min(255, guests.happinessTarget[slot] + boost);
    affected++;
  }
  staff.guestsEntertained[staffSlot] = Math.min(
    0xffff,
    staff.guestsEntertained[staffSlot] + affected,
  );
  return affected;
}
