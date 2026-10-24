import type { World } from '../core/world';
import { GuestState } from './guest-store';

/**
 * Per-ride-slot guest counts, derived from guest state at the start of every tick and never
 * saved. `queued` is the whole line (queuing on the queue tiles plus waiting at the entrance),
 * `approaching` guests have chosen the ride but not reached it, `serving` guests are mid-use of
 * a stall or facility.
 */
export interface RideLines {
  queued: Uint16Array;
  approaching: Uint16Array;
  serving: Uint16Array;
}

export function createRideLines(capacity: number): RideLines {
  return {
    queued: new Uint16Array(capacity),
    approaching: new Uint16Array(capacity),
    serving: new Uint16Array(capacity),
  };
}

/** Rebuilds every count from the guests' current state. */
export function recountRideLines(world: World): void {
  const lines = world.rideLines;
  lines.queued.fill(0, 0, world.rides.count);
  lines.approaching.fill(0, 0, world.rides.count);
  lines.serving.fill(0, 0, world.rides.count);
  const g = world.guests.cols;
  for (let slot = 0; slot < world.guests.count; slot++) {
    const id = g.targetRide[slot];
    if (id < 0) continue;
    const ride = world.rides.idToSlot[id];
    if (world.rides.slotToId[ride] !== id) continue;
    switch (g.state[slot]) {
      case GuestState.Queuing:
      case GuestState.Waiting:
        lines.queued[ride]++;
        break;
      case GuestState.Shopping:
        lines.serving[ride]++;
        break;
      case GuestState.Wandering:
        lines.approaching[ride]++;
        break;
    }
  }
}
