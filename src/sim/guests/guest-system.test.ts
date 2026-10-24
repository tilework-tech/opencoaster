import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { hashWorld } from '../core/hash';
import { GuestState, GuestThought, spawnGuest } from './guest-store';
import { createGuestSystem, guestSystem } from './guest-system';
import { RideState } from '../rides/ride-store';

function world() {
  return new World({ seed: 4, width: 16, height: 16, maxGuests: 8 });
}

describe('guest behaviour', () => {
  it('decays needs and records a hunger thought on a guest update', () => {
    const w = world();
    spawnGuest(w);
    w.guests.cols.hunger[0] = 179;
    w.tick = 1;
    guestSystem.update(w);
    expect(w.guests.cols.hunger[0]).toBe(179);
    w.tick = 0;
    guestSystem.update(w);
    expect(w.guests.cols.hunger[0]).toBe(180);
    expect(w.guests.cols.thought0[0]).toBe(GuestThought.Hungry);
  });

  it('chooses an open affordable ride that matches the guest preference', () => {
    const w = world();
    spawnGuest(w);
    const mismatched = w.rides.spawn();
    w.rides.cols.state[mismatched] = RideState.Open;
    w.rides.cols.price[mismatched] = 100;
    w.rides.cols.excitement[mismatched] = 2000;
    w.rides.cols.intensity[mismatched] = 200;
    const ride = w.rides.spawn();
    w.rides.cols.state[ride] = RideState.Open;
    w.rides.cols.price[ride] = 100;
    w.rides.cols.excitement[ride] = 500;
    w.rides.cols.intensity[ride] = 80;
    const closed = w.rides.spawn();
    w.rides.cols.state[closed] = RideState.Closed;
    w.rides.cols.price[closed] = 100;
    w.rides.cols.excitement[closed] = 3000;
    w.rides.cols.intensity[closed] = 80;
    const unaffordable = w.rides.spawn();
    w.rides.cols.state[unaffordable] = RideState.Open;
    w.rides.cols.price[unaffordable] = 1000;
    w.rides.cols.excitement[unaffordable] = 3000;
    w.rides.cols.intensity[unaffordable] = 80;
    w.guests.cols.cash[0] = 500;
    w.guests.cols.preferredIntensity[0] = 80;
    w.guests.cols.nauseaTolerance[0] = 50;
    w.rides.cols.entranceX[ride] = (w.guests.cols.x[0] / 256) | 0;
    w.rides.cols.entranceY[ride] = (w.guests.cols.y[0] / 256) | 0;
    w.guests.cols.x[0] = w.rides.cols.entranceX[ride] * 256 + 128;
    w.guests.cols.y[0] = w.rides.cols.entranceY[ride] * 256 + 128;
    w.tick = 0;
    guestSystem.update(w);
    expect(w.guests.cols.state[0]).toBe(GuestState.Queuing);
    expect(w.guests.cols.targetRide[0]).toBe(w.rides.slotToId[ride]);
  });

  it('completes a queued ride, charges the guest, and updates their mood and nausea', () => {
    const w = world();
    spawnGuest(w);
    const ride = w.rides.spawn();
    w.rides.cols.state[ride] = RideState.Open;
    w.rides.cols.price[ride] = 100;
    w.rides.cols.excitement[ride] = 500;
    w.rides.cols.intensity[ride] = 80;
    w.rides.cols.nausea[ride] = 64;
    w.guests.cols.preferredIntensity[0] = 80;
    w.guests.cols.nauseaTolerance[0] = 100;
    w.guests.cols.nausea[0] = 80;
    w.rides.cols.entranceX[ride] = (w.guests.cols.x[0] / 256) | 0;
    w.rides.cols.entranceY[ride] = (w.guests.cols.y[0] / 256) | 0;
    const cash = w.guests.cols.cash[0];
    const system = createGuestSystem(undefined, () => ({ parkRating: 0, entranceFee: 0 }));
    for (let tick = 0; tick < 4 * 240; tick += 4) {
      w.tick = tick;
      system.update(w);
    }
    const happinessBeforeRideCompletion = w.guests.cols.happiness[0];
    w.tick = 4 * 240;
    system.update(w);
    expect(w.guests.cols.state[0]).toBe(GuestState.Wandering);
    expect(w.guests.cols.cash[0]).toBeLessThan(cash);
    expect(w.guests.cols.happiness[0]).toBeGreaterThan(happinessBeforeRideCompletion);
    expect(w.guests.cols.nausea[0]).toBeGreaterThan(0);
    expect(w.rides.cols.queueLength[ride]).toBe(0);
  });

  it('leaves through the exit state when needs and happiness are exhausted', () => {
    const w = world();
    spawnGuest(w);
    w.guests.cols.happiness[0] = 0;
    w.guests.cols.energy[0] = 0;
    for (let tick = 0; tick < 16; tick++) {
      w.tick = tick;
      guestSystem.update(w);
    }
    expect(w.guests.cols.state[0]).toBe(GuestState.Leaving);
    expect(w.guests.cols.thought0[0]).toBe(GuestThought.Leaving);
  });

  it('attracts guests from favorable admission inputs and rejects an excessive fee', () => {
    const favorable = world();
    createGuestSystem(undefined, () => ({ parkRating: 1000, entranceFee: 0 })).update(favorable);
    expect(favorable.guests.count).toBe(1);

    const expensive = world();
    createGuestSystem(undefined, () => ({ parkRating: 1000, entranceFee: 5000 })).update(expensive);
    expect(expensive.guests.count).toBe(0);
  });

  it('keeps guest outcomes deterministic for the same seed and tick sequence', () => {
    const first = world();
    const second = world();
    for (let i = 0; i < 100; i++) {
      spawnGuest(first);
      spawnGuest(second);
    }
    for (let tick = 0; tick < 200; tick++) {
      first.tick = tick;
      second.tick = tick;
      guestSystem.update(first);
      guestSystem.update(second);
    }
    expect(hashWorld(first)).toBe(hashWorld(second));
  });
});
