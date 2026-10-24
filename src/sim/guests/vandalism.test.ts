import { describe, expect, it } from 'vitest';
import { createVandalismSystem } from './vandalism';
import { PathAddition, setPathAddition } from '../map/paths';
import { PathFlag } from '../map/tile-map';
import { flatWorld, guestAt, layPath, row } from '../integration/fixtures';
import { setStaffOrder, StaffKind, spawnStaff } from '../staff/staff-store';
import { TILE_UNITS } from '../core/constants';
import { dropLitter, LitterKind } from './litter-store';
import { hashWorld } from '../core/hash';

const CHECK_INTERVAL = 32;

function benchWorld(guestHappiness: number, energy = 128, hasLitter = true) {
  const w = flatWorld(16, 6);
  layPath(w, row(6, 4, 10));
  setPathAddition(w.map, 7, 6, PathAddition.Bench);
  const guest = guestAt(w, 7, 6);
  w.guests.cols.happiness[guest] = guestHappiness;
  w.guests.cols.energy[guest] = energy;
  if (hasLitter) dropLitter(w, 7, 6, LitterKind.Trash);
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
  it('breaks a bench under an unhappy energetic guest when the park has litter', () => {
    const w = benchWorld(20);

    runChecks(w, 400);

    expect(w.map.elFlags[benchElement(w)] & PathFlag.Bench).toBe(0);
  });

  it('leaves the bench alone when guests are content', () => {
    const w = benchWorld(200);

    runChecks(w, 400);

    expect(w.map.elFlags[benchElement(w)] & PathFlag.Bench).toBe(PathFlag.Bench);
  });

  it('does not vandalise when the guest is too tired', () => {
    const w = benchWorld(20, 84);

    runChecks(w, 1000);

    expect(w.map.elFlags[benchElement(w)] & PathFlag.Bench).toBe(PathFlag.Bench);
  });

  it('does not vandalise a clean park', () => {
    const w = benchWorld(20, 128, false);

    runChecks(w, 1000);

    expect(w.map.elFlags[benchElement(w)] & PathFlag.Bench).toBe(PathFlag.Bench);
  });

  it('makes the same vandalism decisions for the same seed', () => {
    const first = benchWorld(20);
    const second = benchWorld(20);

    runChecks(first, 400);
    runChecks(second, 400);

    expect(hashWorld(first)).toBe(hashWorld(second));
  });

  it('is deterred by a security guard within six tiles', () => {
    const w = benchWorld(20);
    spawnStaff(w, StaffKind.Security);
    w.staff.cols.x[0] = 9 * TILE_UNITS + 128;
    w.staff.cols.y[0] = 8 * TILE_UNITS + 128;

    runChecks(w, 400);

    expect(w.map.elFlags[benchElement(w)] & PathFlag.Bench).toBe(PathFlag.Bench);
  });

  it('does not treat a guard with vandalism duty disabled as a deterrent', () => {
    const w = benchWorld(20);
    spawnStaff(w, StaffKind.Security);
    const staffId = w.staff.slotToId[0];
    setStaffOrder(w, staffId, 'watch-for-vandalism', false);
    w.staff.cols.x[0] = 9 * TILE_UNITS + 128;
    w.staff.cols.y[0] = 8 * TILE_UNITS + 128;

    runChecks(w, 400);

    expect(w.map.elFlags[benchElement(w)] & PathFlag.Bench).toBe(0);
  });

  it('ignores a security guard farther away than six tiles', () => {
    const w = benchWorld(20);
    spawnStaff(w, StaffKind.Security);
    w.staff.cols.x[0] = 14 * TILE_UNITS + 128;
    w.staff.cols.y[0] = 14 * TILE_UNITS + 128;

    runChecks(w, 400);

    expect(w.map.elFlags[benchElement(w)] & PathFlag.Bench).toBe(0);
  });
});
