import { describe, expect, it } from 'vitest';
import { createVandalismSystem } from './vandalism';
import { PathAddition, setPathAddition } from '../map/paths';
import { PathFlag } from '../map/tile-map';
import { flatWorld, guestAt, layPath, row } from '../integration/fixtures';
import { StaffKind, spawnStaff } from '../staff/staff-store';
import { TILE_UNITS } from '../core/constants';

const CHECK_INTERVAL = 32;

function benchWorld(guestHappiness: number) {
  const w = flatWorld(16, 6);
  layPath(w, row(6, 4, 10));
  setPathAddition(w.map, 7, 6, PathAddition.Bench);
  const guest = guestAt(w, 7, 6);
  w.guests.cols.happiness[guest] = guestHappiness;
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
  it('breaks a bench under an angry guest', () => {
    const w = benchWorld(20);

    runChecks(w, 400);

    expect(w.map.elFlags[benchElement(w)] & PathFlag.Bench).toBe(0);
  });

  it('leaves the bench alone when guests are content', () => {
    const w = benchWorld(200);

    runChecks(w, 400);

    expect(w.map.elFlags[benchElement(w)] & PathFlag.Bench).toBe(PathFlag.Bench);
  });

  it('is deterred by a security guard within six tiles', () => {
    const w = benchWorld(20);
    spawnStaff(w, StaffKind.Security);
    w.staff.cols.x[0] = 9 * TILE_UNITS + 128;
    w.staff.cols.y[0] = 8 * TILE_UNITS + 128;

    runChecks(w, 400);

    expect(w.map.elFlags[benchElement(w)] & PathFlag.Bench).toBe(PathFlag.Bench);
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
