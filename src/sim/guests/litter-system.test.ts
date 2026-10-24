import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { spawnStaff, StaffKind } from '../staff/staff-store';
import { staffSystem } from '../staff/staff-system';
import { PathAddition, placePath, setPathAddition } from '../map/paths';
import { LitterKind, dropLitter } from './litter-store';
import { litterSystem } from './litter-system';

describe('park litter', () => {
  it('records trash in a path bin and a handyman empties it', () => {
    const world = new World({ seed: 4, width: 16, height: 16 });
    world.map.fillFlat(2);
    expect(placePath(world.map, { x: 8, y: 8, z: 2 })).toBe(true);
    expect(setPathAddition(world.map, 8, 8, PathAddition.Bin)).toBe(true);
    expect(dropLitter(world, 8, 8, LitterKind.Trash)).toBe(true);
    const bin = world.map.pathElement(world.map.index(8, 8), -1);
    expect(world.map.elData[bin]).toBe(1);

    expect(spawnStaff(world, StaffKind.Handyman)).toBe(true);
    world.staff.cols.x[0] = 8 * 256 + 128;
    world.staff.cols.y[0] = 8 * 256 + 128;
    staffSystem.update(world);

    expect(world.map.elData[bin]).toBe(0);
    expect(world.litter.count).toBe(0);
  });

  it('creates vomit on a walkable tile for a highly nauseous guest', () => {
    const world = new World({ seed: 4, width: 16, height: 16 });
    world.map.fillFlat(2);
    expect(placePath(world.map, { x: 8, y: 8, z: 2 })).toBe(true);
    const guest = world.guests.spawn();
    world.guests.cols.x[guest] = 8 * 256 + 128;
    world.guests.cols.y[guest] = 8 * 256 + 128;
    world.guests.cols.nausea[guest] = 220;
    world.tick = 0;

    litterSystem.update(world);

    expect(world.litter.count).toBe(1);
    expect(world.litter.cols.kind[0]).toBe(LitterKind.Vomit);
  });

  it('refreshes cached bins when the active world changes', () => {
    const first = new World({ seed: 1, width: 16, height: 16 });
    first.map.fillFlat(2);
    placePath(first.map, { x: 4, y: 4, z: 2 });
    setPathAddition(first.map, 4, 4, PathAddition.Bin);
    dropLitter(first, 4, 4, LitterKind.Trash);
    spawnStaff(first, StaffKind.Handyman);
    first.staff.cols.x[0] = 4 * 256 + 128;
    first.staff.cols.y[0] = 4 * 256 + 128;
    staffSystem.update(first);

    const second = new World({ seed: 2, width: 16, height: 16 });
    second.map.fillFlat(2);
    placePath(second.map, { x: 6, y: 6, z: 2 });
    setPathAddition(second.map, 6, 6, PathAddition.Bin);
    dropLitter(second, 6, 6, LitterKind.Trash);
    spawnStaff(second, StaffKind.Handyman);
    second.staff.cols.x[0] = 6 * 256 + 128;
    second.staff.cols.y[0] = 6 * 256 + 128;
    staffSystem.update(second);

    expect(second.litter.count).toBe(0);
    const bin = second.map.pathElement(second.map.index(6, 6), -1);
    expect(second.map.elData[bin]).toBe(0);
  });
});
