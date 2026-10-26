import type { System } from '../core/system';
import type { World } from '../core/world';
import { TILE_UNITS } from '../core/constants';
import { earn, ridePricingEnabled } from '../economy/api';
import { LedgerCategory } from '../economy/ledger';
import { GuestState, recordRideHistory } from '../guests/guest-store';
import { spendVoucher } from '../guests/vouchers';
import { VoucherKind } from '../economy/vouchers';
import { RidePhase } from './ride-store';
import { addRideIncome } from './ride-operations';
import { RIDE_CATALOG } from './ride-types';
import type { RideType } from './ride-types';

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
 * Moves up to `count` guests from the head of the ride's queue (lowest slot first) into `Riding`,
 * charging their tickets. Each carries `tag`, the completed-trip count at which their trip ends.
 * Returns how many were seated.
 */
export function seatQueuedGuests(world: World, slot: number, count: number, tag: number): number {
  const ride = world.rides.cols;
  const guests = world.guests.cols;
  const id = world.rides.slotToId[slot];
  const price = ticketPriceCents(world, slot);
  let seated = 0;
  while (seated < count) {
    let next = -1;
    for (let g = 0; g < world.guests.count; g++) {
      if (guests.state[g] !== GuestState.Waiting || guests.targetRide[g] !== id) continue;
      if (next < 0 || guests.queueSeq[g] < guests.queueSeq[next]) next = g;
    }
    if (next < 0) break;
    const g = next;
    const fare = spendVoucher(world, g, id, VoucherKind.FreeRide)
      ? 0
      : Math.min(price, guests.cash[g]);
    guests.cash[g] -= fare;
    if (fare > 0) {
      earn(world, LedgerCategory.RideTickets, fare);
      addRideIncome(world, slot, fare);
    }
    guests.state[g] = GuestState.Riding;
    recordRideHistory(world, g, id);
    guests.activityTicks[g] = tag & 0xffff;
    guests.x[g] = ride.rideX[slot] * TILE_UNITS + (TILE_UNITS >> 1);
    guests.y[g] = ride.rideY[slot] * TILE_UNITS + (TILE_UNITS >> 1);
    seated++;
  }
  return seated;
}

/**
 * Seats guests on a flat ride the tick it dispatches. The ride system removes `boarded` guests
 * from `queueLength`, which counts exactly the guests in `Waiting` at the head of the queue; this
 * moves that many of them into `Riding`. A guest finishes the ride when the ride's
 * completed-cycle counter moves past the value stored on boarding. Track rides seat their own
 * guests when a train loads.
 */
export const rideQueueSystem: System = {
  name: 'ride-queue',
  update(world) {
    const ride = world.rides.cols;
    for (let slot = 0; slot < world.rides.count; slot++) {
      if (RIDE_CATALOG[ride.typeId[slot] as RideType]?.usesTrack) continue;
      if (!justDispatched(world, slot)) continue;
      ride.boarded[slot] = seatQueuedGuests(
        world,
        slot,
        ride.boarded[slot],
        ride.cyclesCompleted[slot],
      );
    }
  },
};
