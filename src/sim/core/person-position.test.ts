import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { hashWorld } from './hash';
import { OWNED } from '../map/tile-map';
import { GuestState } from '../guests/guest-store';
import { StaffKind } from '../staff/staff-store';
import { TILE_UNITS } from './constants';
import { deserialize, serialize } from '../../save/save';

describe('setPersonPosition command', () => {
  it('moves a guest and staff member onto the center of owned land deterministically', () => {
    const run = () => {
      const sim = new Simulation({ seed: 9, width: 16, height: 16, maxGuests: 10 });
      sim.world.map.ownership.fill(OWNED);
      sim.world.map.waterLevel.fill(0);
      sim.enqueue({ type: 'spawnGuests', count: 1 });
      sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
      sim.applyPendingCommands();
      const guestId = sim.world.guests.slotToId[0];
      const staffId = sim.world.staff.slotToId[0];
      sim.enqueue({ type: 'setPersonPosition', person: 'guest', personId: guestId, x: 6, y: 7 });
      sim.enqueue({ type: 'setPersonPosition', person: 'staff', personId: staffId, x: 8, y: 9 });
      sim.applyPendingCommands();
      return sim;
    };
    const first = run();
    const second = run();

    expect(first.world.guests.cols.x[0]).toBe(6 * TILE_UNITS + TILE_UNITS / 2);
    expect(first.world.guests.cols.y[0]).toBe(7 * TILE_UNITS + TILE_UNITS / 2);
    expect(first.world.guests.cols.targetX[0]).toBe(6);
    expect(first.world.guests.cols.targetY[0]).toBe(7);
    expect(first.world.guests.cols.state[0]).toBe(GuestState.Wandering);
    expect(first.world.staff.cols.x[0]).toBe(8 * TILE_UNITS + TILE_UNITS / 2);
    expect(first.world.staff.cols.y[0]).toBe(9 * TILE_UNITS + TILE_UNITS / 2);
    expect(first.world.staff.cols.targetX[0]).toBe(8);
    expect(first.world.staff.cols.targetY[0]).toBe(9);
    expect(hashWorld(first.world)).toBe(hashWorld(second.world));
  });

  it('does not move a queued guest or place a person on unowned land', () => {
    const sim = new Simulation({ seed: 10, width: 16, height: 16, maxGuests: 10 });
    sim.world.map.ownership.fill(OWNED);
    sim.world.map.waterLevel.fill(0);
    sim.enqueue({ type: 'spawnGuests', count: 1 });
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
    sim.applyPendingCommands();
    const guestId = sim.world.guests.slotToId[0];
    const staffId = sim.world.staff.slotToId[0];
    sim.enqueue({ type: 'setPersonPosition', person: 'guest', personId: guestId, x: 4, y: 4 });
    sim.enqueue({ type: 'setPersonPosition', person: 'staff', personId: staffId, x: 4, y: 4 });
    sim.applyPendingCommands();
    sim.world.guests.cols.state[0] = GuestState.Queuing;
    sim.world.map.ownership[sim.world.map.index(12, 12)] = 0;
    const beforeGuest = [
      sim.world.guests.cols.x[0],
      sim.world.guests.cols.y[0],
      sim.world.guests.cols.z[0],
      sim.world.guests.cols.targetX[0],
      sim.world.guests.cols.targetY[0],
      sim.world.guests.cols.state[0],
    ];
    const beforeStaff = [
      sim.world.staff.cols.x[0],
      sim.world.staff.cols.y[0],
      sim.world.staff.cols.z[0],
      sim.world.staff.cols.targetX[0],
      sim.world.staff.cols.targetY[0],
    ];
    sim.enqueue({ type: 'setPersonPosition', person: 'guest', personId: guestId, x: 5, y: 5 });
    sim.enqueue({ type: 'setPersonPosition', person: 'staff', personId: staffId, x: 12, y: 12 });

    sim.applyPendingCommands();

    expect([
      sim.world.guests.cols.x[0],
      sim.world.guests.cols.y[0],
      sim.world.guests.cols.z[0],
      sim.world.guests.cols.targetX[0],
      sim.world.guests.cols.targetY[0],
      sim.world.guests.cols.state[0],
    ]).toEqual(beforeGuest);
    expect([
      sim.world.staff.cols.x[0],
      sim.world.staff.cols.y[0],
      sim.world.staff.cols.z[0],
      sim.world.staff.cols.targetX[0],
      sim.world.staff.cols.targetY[0],
    ]).toEqual(beforeStaff);
  });

  it('preserves moved positions through save and load', () => {
    const sim = new Simulation({ seed: 11, width: 16, height: 16, maxGuests: 10 });
    sim.world.map.ownership.fill(OWNED);
    sim.world.map.waterLevel.fill(0);
    sim.enqueue({ type: 'spawnGuests', count: 1 });
    sim.step();
    sim.applyPendingCommands();
    sim.enqueue({ type: 'setPersonPosition', person: 'guest', personId: 0, x: 10, y: 4 });
    sim.applyPendingCommands();

    const restored = deserialize(serialize(sim.world));

    expect(restored.guests.cols.x[0]).toBe(10 * TILE_UNITS + TILE_UNITS / 2);
    expect(restored.guests.cols.y[0]).toBe(4 * TILE_UNITS + TILE_UNITS / 2);
    expect(hashWorld(restored)).toBe(hashWorld(sim.world));
  });
});
