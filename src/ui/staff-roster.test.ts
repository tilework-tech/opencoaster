import { describe, expect, it } from 'vitest';
import { World } from '../sim/core/world';
import { StaffKind, spawnStaff } from '../sim/staff/staff-store';
import { createSnapshot, writeSnapshot } from '../worker/snapshot';
import { rosterEntries } from './staff-roster';

describe('staff roster', () => {
  function snapshotWithStaff() {
    const world = new World({ seed: 5, width: 8, height: 8 });
    spawnStaff(world, StaffKind.Handyman);
    spawnStaff(world, StaffKind.Security);
    const [handyman, guard] = [world.staff.slotToId[0], world.staff.slotToId[1]];
    world.staffNames.set(guard, 'Rex');
    const snapshot = createSnapshot({ guests: 0, staff: 4, vehicles: 0, litter: 0, mapTiles: 64 });
    writeSnapshot(world, snapshot);
    return { snapshot, handyman, guard };
  }

  it('lists each staff member with its kind, name and role', () => {
    const { snapshot, handyman, guard } = snapshotWithStaff();

    expect(rosterEntries(snapshot)).toEqual([
      { id: handyman, kind: 0, name: `Handyman ${handyman + 1}`, role: 'Handyman' },
      { id: guard, kind: 2, name: 'Rex', role: 'Security' },
    ]);
  });

  it('is empty before the first snapshot arrives', () => {
    expect(rosterEntries(null)).toEqual([]);
  });
});
