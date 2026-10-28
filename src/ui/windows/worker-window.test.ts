import { describe, expect, it } from 'vitest';
import { World } from '../../sim/core/world';
import { StaffKind, spawnStaff } from '../../sim/staff/staff-store';
import { createSnapshot, writeSnapshot } from '../../worker/snapshot';
import { workerDetails } from './worker-window';

describe('worker details', () => {
  it('resolves a worker by stable id with its current role, tile, and weekly wage', () => {
    const world = new World({ seed: 11, width: 8, height: 8 });
    spawnStaff(world, StaffKind.Handyman);
    spawnStaff(world, StaffKind.Mechanic);
    const id = world.staff.slotToId[1];
    world.staff.cols.x[1] = 4 * 256 + 128;
    world.staff.cols.y[1] = 6 * 256 + 128;
    world.staff.cols.z[1] = 2 * 64;
    world.staffNames.set(id, 'Ada');
    const snapshot = createSnapshot({ guests: 0, staff: 2, vehicles: 0, litter: 0, mapTiles: 64 });
    writeSnapshot(world, snapshot);

    expect(workerDetails(snapshot, id)).toEqual({
      id,
      name: 'Ada',
      kind: StaffKind.Mechanic,
      role: 'Mechanic',
      tileX: 4,
      tileY: 6,
      height: 2,
      weeklyWage: 2000,
    });
  });

  it('returns no details after the worker disappears from the latest snapshot', () => {
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });
    expect(workerDetails(snapshot, 123)).toBeNull();
  });
});
