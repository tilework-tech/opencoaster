import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { spawnStaff, StaffKind } from '../staff/staff-store';
import { staffSystem } from '../staff/staff-system';
import { PathAddition, placePath, setPathAddition } from '../map/paths';
import { LitterKind, dropLitter } from './litter-store';
import { litterSystem } from './litter-system';
import { OWNED } from '../map/tile-map';

describe('park litter', () => {
  it('keeps litter until a handyman removes it instead of aging it out', () => {
    const world = new World({ seed: 18, width: 16, height: 16 });
    world.map.fillFlat(2);
    expect(placePath(world.map, { x: 8, y: 8, z: 2 })).toBe(true);
    expect(dropLitter(world, 8, 8, LitterKind.Trash)).toBe(true);
    world.litter.cols.age[0] = 20_000;
    world.tick = 1;

    litterSystem.update(world);

    expect(world.litter.count).toBe(1);
  });

  it('evicts by creation order when litter ages are saturated and ids are reused', () => {
    const world = new World({ seed: 20, width: 600, height: 5 });
    world.map.fillFlat(2);
    world.map.ownership.fill(OWNED);
    for (let x = 2; x <= 501; x++) {
      expect(placePath(world.map, { x, y: 2, z: 2 })).toBe(true);
      expect(dropLitter(world, x, 2, LitterKind.Trash)).toBe(true);
    }
    world.litter.cols.age.fill(0xffff, 0, world.litter.count);
    world.litter.despawnId(0);
    expect(placePath(world.map, { x: 502, y: 2, z: 2 })).toBe(true);
    expect(placePath(world.map, { x: 503, y: 2, z: 2 })).toBe(true);
    expect(dropLitter(world, 502, 2, LitterKind.Trash)).toBe(true);
    world.litter.cols.age[world.litter.count - 1] = 0xffff;
    expect(dropLitter(world, 503, 2, LitterKind.Trash)).toBe(true);

    const survivingTiles = new Set(
      Array.from(world.litter.cols.x.subarray(0, world.litter.count), (x) => x >> 8),
    );
    expect(survivingTiles.has(501)).toBe(true);
    expect(survivingTiles.has(502)).toBe(false);
    expect(survivingTiles.has(503)).toBe(true);
  });

  it('records trash in a path bin and a handyman empties it', () => {
    const world = new World({ seed: 4, width: 16, height: 16 });
    world.map.fillFlat(2);
    expect(placePath(world.map, { x: 8, y: 8, z: 2 })).toBe(true);
    expect(setPathAddition(world.map, 8, 8, PathAddition.Bin)).toBe(true);
    const bin = world.map.pathElement(world.map.index(8, 8), -1);
    expect(world.map.elData[bin]).toBe(0xff);
    expect(dropLitter(world, 8, 8, LitterKind.Trash)).toBe(true);
    expect(world.map.elData[bin]).not.toBe(0);

    expect(spawnStaff(world, StaffKind.Handyman)).toBe(true);
    world.staff.cols.x[0] = 8 * 256 + 128;
    world.staff.cols.y[0] = 8 * 256 + 128;
    staffSystem.update(world);

    expect(world.map.elData[bin]).toBe(0xff);
    expect(world.litter.count).toBe(0);
  });

  it('spawns litter when every corner of a bin is full', () => {
    const world = new World({ seed: 12, width: 16, height: 16 });
    world.map.fillFlat(2);
    expect(placePath(world.map, { x: 8, y: 8, z: 2 })).toBe(true);
    expect(setPathAddition(world.map, 8, 8, PathAddition.Bin)).toBe(true);
    const bin = world.map.pathElement(world.map.index(8, 8), -1);
    world.map.elData[bin] = 0;

    expect(dropLitter(world, 8, 8, LitterKind.Trash)).toBe(true);

    expect(world.litter.count).toBe(1);
  });

  it('creates vomit on a walkable tile for a highly nauseous guest', () => {
    const world = new World({ seed: 4, width: 16, height: 16 });
    world.map.fillFlat(2);
    expect(placePath(world.map, { x: 8, y: 8, z: 2 })).toBe(true);
    const guest = world.guests.spawn();
    world.guests.cols.x[guest] = 8 * 256 + 128;
    world.guests.cols.y[guest] = 8 * 256 + 128;
    world.guests.cols.nausea[guest] = 220;
    world.guests.cols.hunger[guest] = 80;
    world.tick = 0;

    litterSystem.update(world);

    expect(world.litter.count).toBe(1);
    expect(world.litter.cols.kind[0]).toBe(LitterKind.Vomit);
    expect(world.guests.cols.nausea[guest]).toBe(190);
    expect(world.guests.cols.hunger[guest]).toBe(40);
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
    expect(second.map.elData[bin]).toBe(0xff);
  });
});
