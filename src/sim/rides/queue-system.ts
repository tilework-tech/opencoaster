import type { System } from '../core/system';
import type { World } from '../core/world';
import { TILE_UNITS } from '../core/constants';
import { earn, ridePricingEnabled } from '../economy/api';
import { LedgerCategory } from '../economy/ledger';
import { GuestState } from '../guests/guest-store';
import { RidePhase } from './ride-store';

/** Ticket price a guest pays to board: zero unless the park charges per ride. */
export function ticketPriceCents(world: World, rideSlot: number): number {
  return ridePricingEnabled(world) ? world.rides.cols.price[rideSlot] : 0;
}

/** True on the single tick a ride dispatches riders and starts its cycle. */
function justDispatched(world: World, slot: number): boolean {
  const ride = world.rides.cols;
  if (ride.boarded[slot] === 0) return false;
  return ride.phase[slot] === RidePhase.Loading
    ? ride.phaseTicks[slot] === ride.loadTicks[slot]
    : ride.phase[slot] === RidePhase.Running &&
        ride.loadTicks[slot] === 0 &&
        ride.phaseTicks[slot] === ride.runTicks[slot];
}

/**
 * Seats guests on a ride the tick it dispatches. The ride system removes `boarded` guests from
 * `queueLength`, which counts exactly the guests in `Waiting` at the head of the queue; this
 * moves that many of them (lowest slot first) into `Riding`, charging their tickets. A guest
 * finishes the ride when the ride's completed-cycle counter moves past the value stored on boarding.
 */
export const rideQueueSystem: System = {
  name: 'ride-queue',
  update(world) {
    const ride = world.rides.cols;
    const guests = world.guests.cols;
    for (let slot = 0; slot < world.rides.count; slot++) {
      if (!justDispatched(world, slot)) continue;
      const id = world.rides.slotToId[slot];
      const price = ticketPriceCents(world, slot);
      const cycle = ride.cyclesCompleted[slot] & 0xffff;
      let seated = 0;
      for (let g = 0; g < world.guests.count && seated < ride.boarded[slot]; g++) {
        if (guests.state[g] !== GuestState.Waiting || guests.targetRide[g] !== id) continue;
        const fare = Math.min(price, guests.cash[g]);
        guests.cash[g] -= fare;
        if (fare > 0) earn(world, LedgerCategory.RideTickets, fare);
        guests.state[g] = GuestState.Riding;
        guests.activityTicks[g] = cycle;
        guests.x[g] = ride.rideX[slot] * TILE_UNITS + (TILE_UNITS >> 1);
        guests.y[g] = ride.rideY[slot] * TILE_UNITS + (TILE_UNITS >> 1);
        seated++;
      }
      ride.boarded[slot] = seated;
    }
  },
};
