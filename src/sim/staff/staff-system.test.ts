import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { TICKS_PER_WEEK } from '../economy/calendar';
import { LedgerCategory } from '../economy/ledger';
import { placePath } from '../map/paths';
import { RidePhase, RideState } from '../rides/ride-store';
import { createRide, triggerRideBreakdown } from '../rides/ride-operations';
import { RideType } from '../rides/ride-types';
import { StaffKind, spawnStaff } from './staff-store';
import { dropLitter, LitterKind } from '../guests/litter-store';
import { staffSystem } from './staff-system';

describe('staff commands and work', () => {
  it('hires and fires staff while updating the weekly wage bill', () => {
    const sim = new Simulation({ seed: 8, width: 16, height: 16 });
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
    sim.step();

    expect(sim.world.staff.count).toBe(1);
    expect(sim.world.economy.inputs.wageBillPerWeek).toBeGreaterThan(0);

    const beforePayday = sim.world.economy.cash;
    sim.world.tick = TICKS_PER_WEEK;
    sim.step();
    expect(sim.world.economy.cash).toBeLessThan(beforePayday);
    expect(sim.world.economy.monthlyTotals[LedgerCategory.Wages]).toBeLessThan(0);

    sim.enqueue({ type: 'fireStaff', staffId: sim.world.staff.slotToId[0] });
    sim.step();
    expect(sim.world.staff.count).toBe(0);
    expect(sim.world.economy.inputs.wageBillPerWeek).toBe(0);
  });

  it('uses a patrol area to keep a handyman on its connected paths', () => {
    const sim = new Simulation({ seed: 2, width: 16, height: 16 });
    const w = sim.world;
    w.map.fillFlat(2);
    for (let x = 4; x <= 10; x++) sim.enqueue({ type: 'placePath', x, y: 6, z: 2 });
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
    sim.step();
    const staffId = w.staff.slotToId[0];
    for (let x = 4; x <= 7; x++)
      sim.enqueue({ type: 'setStaffPatrolTile', staffId, x, y: 6, enabled: true });
    sim.step();
    w.staff.cols.x[0] = 4 * 256 + 128;
    w.staff.cols.y[0] = 6 * 256 + 128;
    dropLitter(w, 7, 6, LitterKind.Trash);
    dropLitter(w, 10, 6, LitterKind.Trash);
    for (let i = 0; i < 300; i++) {
      sim.step();
      const tileX = Math.floor(w.staff.cols.x[0] / 256);
      const tileY = Math.floor(w.staff.cols.y[0] / 256);
      expect(tileY).toBe(6);
      expect(tileX).toBeGreaterThanOrEqual(4);
      expect(tileX).toBeLessThanOrEqual(7);
    }

    expect(w.litter.count).toBe(1);
    expect(w.litter.cols.x[0]).toBe(10 * 256 + 128);
  });

  it('sends a mechanic to a broken ride and restores its operation', () => {
    const sim = new Simulation({ seed: 3, width: 16, height: 16 });
    const world = sim.world;
    world.map.fillFlat(2);
    placePath(world.map, { x: 7, y: 8, z: 2 });
    const rideId = createRide(world, RideType.MerryGoRound, 8, 8);
    const rideSlot = world.rides.idToSlot[rideId];
    world.rides.cols.state[rideSlot] = RideState.Open;
    world.rides.cols.phase[rideSlot] = RidePhase.Waiting;
    world.rides.cols.queueConnected[rideSlot] = 1;
    expect(triggerRideBreakdown(world, rideId)).toBe(true);
    expect(spawnStaff(world, StaffKind.Mechanic)).toBe(true);
    world.staff.cols.x[0] = 7 * 256 + 128;
    world.staff.cols.y[0] = 8 * 256 + 128;

    staffSystem.update(world);

    expect(world.rides.cols.state[rideSlot]).toBe(RideState.Open);
    expect(world.rides.cols.phase[rideSlot]).toBe(RidePhase.Waiting);
    expect(world.rides.cols.reliability[rideSlot]).toBe(100);
  });
});
