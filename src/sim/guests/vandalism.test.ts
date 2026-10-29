import { describe, expect, it } from 'vitest';
import { createVandalismSystem, GUEST_LITTER_MEMORY_TICKS } from './vandalism';
import { GuestState } from './guest-store';
import { PathAddition, placePath, setPathAddition } from '../map/paths';
import { isPathElementBroken, PathFlag } from '../map/tile-map';
import { flatWorld, guestAt, layPath, row } from '../integration/fixtures';
import { setStaffOrder, StaffKind, spawnStaff } from '../staff/staff-store';
import { TILE_UNITS } from '../core/constants';
import { dropLitter, LitterKind } from './litter-store';
import { hashWorld } from '../core/hash';
import { setParkEntrance } from './park';

const CHECK_INTERVAL = 32;

function benchWorld(guestHappiness: number) {
  const w = flatWorld(16, 6);
  layPath(w, row(6, 4, 10));
  setPathAddition(w.map, 7, 6, PathAddition.Bench);
  const guest = guestAt(w, 7, 6);
  setParkEntrance(w, 4, 6);
  w.guests.cols.happiness[guest] = guestHappiness;
  dropLitter(w, 7, 6, LitterKind.Trash);
  return w;
}

function runChecks(w: ReturnType<typeof flatWorld>, checks: number): void {
  const system = createVandalismSystem();
  for (let i = 0; i < checks; i++) {
    w.tick = i * CHECK_INTERVAL;
    system.update(w);
  }
}

function benchElement(w: ReturnType<typeof flatWorld>): number {
  return w.map.pathElement(w.map.index(7, 6), -1);
}

describe('vandalism', () => {
  it('marks a bench under an angry guest as broken and keeps the addition', () => {
    const w = benchWorld(20);
    const system = createVandalismSystem();
    let broken = false;
    for (let i = 0; i < 400; i++) {
      w.tick = i * CHECK_INTERVAL;
      system.update(w);
      if (isPathElementBroken(w.map, benchElement(w))) {
        broken = true;
        expect(w.guests.cols.angriness[0]).toBeGreaterThan(0);
        break;
      }
    }

    expect(broken).toBe(true);
    expect(w.map.elFlags[benchElement(w)] & PathFlag.Bench).toBe(PathFlag.Bench);
    expect(isPathElementBroken(w.map, benchElement(w))).toBe(true);
  });

  it('replays vandalism deterministically from the same seed', () => {
    const first = benchWorld(20);
    const second = benchWorld(20);
    runChecks(first, 400);
    runChecks(second, 400);
    expect(hashWorld(first)).toBe(hashWorld(second));
  });

  it('remembers litter on the guest tile even when the guest is not angry', () => {
    const w = benchWorld(200);
    runChecks(w, 1);

    expect(w.guests.cols.litterMemory[0]).toBe(GUEST_LITTER_MEMORY_TICKS);
  });

  it('decays litter memory and anger while guests are not wandering', () => {
    const w = benchWorld(20);
    w.guests.cols.state[0] = GuestState.Queuing;
    w.guests.cols.litterMemory[0] = 100;
    w.guests.cols.angriness[0] = 160;

    w.tick = CHECK_INTERVAL;
    createVandalismSystem().update(w);

    expect(w.guests.cols.litterMemory[0]).toBe(100 - CHECK_INTERVAL);
    expect(w.guests.cols.angriness[0]).toBe(160 - CHECK_INTERVAL);
  });

  it('repairs a broken path addition when a path piece is placed again', () => {
    const w = benchWorld(20);
    runChecks(w, 400);
    const element = benchElement(w);
    expect(isPathElementBroken(w.map, element)).toBe(true);

    expect(placePath(w.map, { x: 7, y: 6, z: 4 })).toBe(true);

    expect(isPathElementBroken(w.map, element)).toBe(false);
  });

  it('leaves the bench alone when guests are content', () => {
    const w = benchWorld(200);

    runChecks(w, 400);

    expect(w.map.elFlags[benchElement(w)] & PathFlag.Bench).toBe(PathFlag.Bench);
    expect(isPathElementBroken(w.map, benchElement(w))).toBe(false);
  });

  it('does not vandalise without a recent litter or vomit sighting', () => {
    const w = benchWorld(20);
    w.litter.despawnSlot(0);
    runChecks(w, 400);

    expect(isPathElementBroken(w.map, benchElement(w))).toBe(false);
  });

  it('is deterred by a security guard within seven tiles', () => {
    const w = benchWorld(20);
    spawnStaff(w, StaffKind.Security);
    w.staff.cols.x[0] = 9 * TILE_UNITS + 128;
    w.staff.cols.y[0] = 8 * TILE_UNITS + 128;

    runChecks(w, 400);

    expect(w.map.elFlags[benchElement(w)] & PathFlag.Bench).toBe(PathFlag.Bench);
    expect(isPathElementBroken(w.map, benchElement(w))).toBe(false);
    expect(w.staff.cols.vandalsStopped[0]).toBeGreaterThan(0);
  });

  it('is deterred by a guard 6.5 tiles away but not one exactly seven tiles away', () => {
    const near = benchWorld(20);
    spawnStaff(near, StaffKind.Security);
    near.staff.cols.x[0] = 7 * TILE_UNITS + 128 + Math.floor(6.4 * TILE_UNITS);
    near.staff.cols.y[0] = 6 * TILE_UNITS + 128;
    runChecks(near, 400);
    expect(isPathElementBroken(near.map, benchElement(near))).toBe(false);

    const edge = benchWorld(20);
    spawnStaff(edge, StaffKind.Security);
    edge.staff.cols.x[0] = 7 * TILE_UNITS + 128 + 7 * TILE_UNITS;
    edge.staff.cols.y[0] = 6 * TILE_UNITS + 128;
    runChecks(edge, 400);
    expect(isPathElementBroken(edge.map, benchElement(edge))).toBe(true);
  });

  it('does not treat a guard with vandalism duty disabled as a deterrent', () => {
    const w = benchWorld(20);
    spawnStaff(w, StaffKind.Security);
    const staffId = w.staff.slotToId[0];
    setStaffOrder(w, staffId, 'watch-for-vandalism', false);
    w.staff.cols.x[0] = 9 * TILE_UNITS + 128;
    w.staff.cols.y[0] = 8 * TILE_UNITS + 128;

    runChecks(w, 400);

    expect(isPathElementBroken(w.map, benchElement(w))).toBe(true);
  });

  it('ignores a security guard farther away than seven tiles', () => {
    const w = benchWorld(20);
    spawnStaff(w, StaffKind.Security);
    w.staff.cols.x[0] = 15 * TILE_UNITS + 128;
    w.staff.cols.y[0] = 15 * TILE_UNITS + 128;

    runChecks(w, 400);

    expect(w.map.elFlags[benchElement(w)] & PathFlag.Bench).toBe(PathFlag.Bench);
    expect(isPathElementBroken(w.map, benchElement(w))).toBe(true);
  });
});
