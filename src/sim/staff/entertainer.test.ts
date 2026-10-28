import { describe, expect, it } from 'vitest';
import { flatWorld, guestAt, layPath, row } from '../integration/fixtures';
import { Z_STEP } from '../core/constants';
import { GuestState } from '../guests/guest-store';
import { ENTERTAINER_WAVE_ROLL, entertainNearbyGuests, QUEUE_WAIT_RELIEF } from './entertainer';
import { setStaffPatrolTile, spawnStaff, StaffKind } from './staff-store';
import { staffSystem } from './staff-system';
import { TILE_UNITS } from '../core/constants';

function setup() {
  const w = flatWorld(24, 8);
  layPath(w, row(6, 2, 16));
  spawnStaff(w, StaffKind.Entertainer);
  w.staff.cols.x[0] = 8 * TILE_UNITS + 128;
  w.staff.cols.y[0] = 6 * TILE_UNITS + 128;
  return w;
}

function guest(w: ReturnType<typeof setup>, x: number, state: GuestState, target = 100): number {
  const slot = guestAt(w, x, 6);
  w.guests.cols.state[slot] = state;
  w.guests.cols.happiness[slot] = target;
  w.guests.cols.happinessTarget[slot] = target;
  return slot;
}

describe('entertainer wave', () => {
  it('lifts the happiness target of a walking guest by 4 and a queuing guest by 3', () => {
    const w = setup();
    const walking = guest(w, 11, GuestState.Wandering);
    const queuing = guest(w, 5, GuestState.Queuing);
    const waiting = guest(w, 6, GuestState.Waiting);
    w.guests.cols.patience[queuing] = 500;
    w.guests.cols.patience[waiting] = 150;

    const affected = entertainNearbyGuests(w, 0);

    expect(w.guests.cols.happinessTarget[walking]).toBe(104);
    expect(w.guests.cols.happinessTarget[queuing]).toBe(103);
    expect(w.guests.cols.happinessTarget[waiting]).toBe(103);
    expect(w.guests.cols.patience[queuing]).toBe(500 - QUEUE_WAIT_RELIEF);
    expect(w.guests.cols.patience[waiting]).toBe(0);
    expect(w.guests.cols.happiness[walking]).toBe(100);
    expect(affected).toBe(3);
    expect(w.staff.cols.guestsEntertained[0]).toBe(3);
  });

  it('reaches three tiles in each axis, but not four, riders, or another floor', () => {
    const w = setup();
    const edge = guest(w, 11, GuestState.Wandering);
    const farEdge = guest(w, 12, GuestState.Wandering);
    const rider = guest(w, 8, GuestState.Riding);
    const upstairs = guest(w, 9, GuestState.Wandering);
    w.guests.cols.z[upstairs] += Z_STEP * 4;

    entertainNearbyGuests(w, 0);

    expect(w.guests.cols.happinessTarget[edge]).toBe(104);
    expect(w.guests.cols.happinessTarget[farEdge]).toBe(100);
    expect(w.guests.cols.happinessTarget[rider]).toBe(100);
    expect(w.guests.cols.happinessTarget[upstairs]).toBe(100);
  });

  it('caps the happiness target at 255', () => {
    const w = setup();
    const happy = guest(w, 9, GuestState.Wandering, 253);
    entertainNearbyGuests(w, 0);
    expect(w.guests.cols.happinessTarget[happy]).toBe(255);
  });

  it('waves on about a quarter of its destination choices', () => {
    expect(ENTERTAINER_WAVE_ROLL).toBe(0x4000);
    const w = setup();
    setStaffPatrolTile(w, w.staff.slotToId[0], 9, 6, true);
    const watcher = guest(w, 9, GuestState.Wandering, 0);
    let choices = 0;
    for (let tick = 0; tick < 80 * 2000; tick++) {
      w.tick = tick;
      w.guests.cols.happinessTarget[watcher] = 0;
      staffSystem.update(w);
      if (((tick + w.staff.slotToId[0]) & 0xf) === 0 && (tick + w.staff.slotToId[0]) % 80 === 0)
        choices++;
    }
    const waves = w.staff.cols.guestsEntertained[0];
    expect(choices).toBe(2000);
    expect(waves / choices).toBeGreaterThan(0.2);
    expect(waves / choices).toBeLessThan(0.3);
  });
});
