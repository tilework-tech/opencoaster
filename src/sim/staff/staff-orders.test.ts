import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { StaffKind, StaffOrder, staffOrderEnabled, staffOrdersForKind } from './staff-store';

describe('staff task orders', () => {
  it('starts workers with their role orders enabled and applies individual changes', () => {
    const simulation = new Simulation({ seed: 8, width: 8, height: 8 });
    simulation.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
    simulation.step();
    const staffId = simulation.world.staff.slotToId[0];
    expect(staffOrderEnabled(simulation.world, staffId, StaffOrder.SweepPaths)).toBe(true);

    simulation.enqueue({
      type: 'setStaffOrder',
      staffId,
      order: 'sweep-paths',
      enabled: false,
    });
    simulation.step();

    expect(staffOrderEnabled(simulation.world, staffId, StaffOrder.SweepPaths)).toBe(false);
    expect(staffOrderEnabled(simulation.world, staffId, StaffOrder.EmptyBins)).toBe(true);

    simulation.enqueue({
      type: 'setStaffOrder',
      staffId,
      order: 'sweep-paths',
      enabled: true,
    });
    simulation.step();
    expect(staffOrderEnabled(simulation.world, staffId, StaffOrder.SweepPaths)).toBe(true);
  });

  it('ignores an order that does not belong to the worker role', () => {
    const simulation = new Simulation({ seed: 9, width: 8, height: 8 });
    simulation.enqueue({ type: 'hireStaff', kind: StaffKind.Security });
    simulation.step();
    const staffId = simulation.world.staff.slotToId[0];

    simulation.enqueue({
      type: 'setStaffOrder',
      staffId,
      order: 'repair-rides',
      enabled: false,
    });
    simulation.step();

    expect(staffOrderEnabled(simulation.world, staffId, StaffOrder.WatchForVandalism)).toBe(true);
    expect(staffOrdersForKind(StaffKind.Security)).toEqual([StaffOrder.WatchForVandalism]);
  });
});
