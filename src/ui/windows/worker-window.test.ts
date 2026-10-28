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
      hiredTick: 0,
      stats: [
        { label: 'Rides inspected', value: 0 },
        { label: 'Rides fixed', value: 0 },
      ],
    });
  });

  it('lists the statistics RCT2 shows for each role', () => {
    const world = new World({ seed: 12, width: 8, height: 8 });
    for (const kind of [
      StaffKind.Handyman,
      StaffKind.Mechanic,
      StaffKind.Security,
      StaffKind.Entertainer,
    ])
      spawnStaff(world, kind);
    const cols = world.staff.cols;
    cols.sweeps[0] = 5;
    cols.lawnsMown[0] = 4;
    cols.gardensWatered[0] = 3;
    cols.binsEmptied[0] = 2;
    cols.ridesInspected[1] = 6;
    cols.ridesFixed[1] = 7;
    cols.vandalsStopped[2] = 8;
    cols.guestsEntertained[3] = 9;
    cols.hiredTick[3] = 40_000;
    const snapshot = createSnapshot({ guests: 0, staff: 4, vehicles: 0, litter: 0, mapTiles: 64 });
    writeSnapshot(world, snapshot);
    const stats = (slot: number) => workerDetails(snapshot, world.staff.slotToId[slot])?.stats;

    expect(stats(0)).toEqual([
      { label: 'Lawns mown', value: 4 },
      { label: 'Gardens watered', value: 3 },
      { label: 'Litter swept', value: 5 },
      { label: 'Bins emptied', value: 2 },
    ]);
    expect(stats(1)).toEqual([
      { label: 'Rides inspected', value: 6 },
      { label: 'Rides fixed', value: 7 },
    ]);
    expect(stats(2)).toEqual([{ label: 'Vandals stopped', value: 8 }]);
    expect(stats(3)).toEqual([{ label: 'Guests entertained', value: 9 }]);
    expect(workerDetails(snapshot, world.staff.slotToId[3])?.hiredTick).toBe(40_000);
  });

  it('returns no details after the worker disappears from the latest snapshot', () => {
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });
    expect(workerDetails(snapshot, 123)).toBeNull();
  });
});
