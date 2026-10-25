import { describe, expect, it } from 'vitest';
import { GuestState, spawnGuest } from '../guests/guest-store';
import { RidePhase } from './ride-store';
import { seatQueuedGuests } from './queue-system';
import { flatOwnedSim } from './coaster-fixtures';

describe('guest ride history', () => {
  it('records the ride when a guest boards and retains the newest rides in order', () => {
    const sim = flatOwnedSim();
    const world = sim.world;
    const first = world.rides.spawn();
    const second = world.rides.spawn();
    const rideIds = [world.rides.slotToId[first], world.rides.slotToId[second]];
    for (const guestSlot of [first, second]) {
      world.rides.cols.phase[guestSlot] = RidePhase.Loading;
      world.rides.cols.rideX[guestSlot] = 10 + guestSlot;
      world.rides.cols.rideY[guestSlot] = 10;
    }
    expect(spawnGuest(world)).toBe(true);
    const guest = 0;
    world.guests.cols.state[guest] = GuestState.Waiting;
    world.guests.cols.targetRide[guest] = rideIds[0];
    seatQueuedGuests(world, first, 1, 1);
    world.guests.cols.state[guest] = GuestState.Waiting;
    world.guests.cols.targetRide[guest] = rideIds[1];
    seatQueuedGuests(world, second, 1, 1);

    expect(Array.from(world.guests.cols.rideHistory0.slice(guest, guest + 1))).toEqual([
      rideIds[0],
    ]);
    expect(Array.from(world.guests.cols.rideHistory1.slice(guest, guest + 1))).toEqual([
      rideIds[1],
    ]);
  });
});
