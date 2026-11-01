import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { hashWorld } from '../core/hash';
import { LedgerCategory } from '../economy/ledger';
import { placePath } from '../map/paths';
import { Surface } from '../map/tile-map';
import { TILE_UNITS } from '../core/constants';
import { FLOWER_BED, FLOWER_BED_COST_CENTS, GROUNDS_GROW_INTERVAL } from './grounds';
import {
  MAX_STAFF_NAME_LENGTH,
  StaffKind,
  setStaffPatrolTile,
  staffPatrolTileEnabled,
} from './staff-store';
import { dropLitter, LitterKind } from '../guests/litter-store';
import { PathAddition, setPathAddition } from '../map/paths';
import { deserialize, serialize } from '../../save/save';

function grassSim(seed: number, size = 16): Simulation {
  const sim = new Simulation({ seed, width: size, height: size });
  sim.world.map.terrain.fill(Surface.Grass);
  sim.world.map.fillFlat(2);
  return sim;
}

function hire(sim: Simulation, kind: number): number {
  sim.enqueue({ type: 'hireStaff', kind });
  sim.step();
  return sim.world.staff.slotToId[sim.world.staff.count - 1];
}

describe('staff names', () => {
  it('renames a staff member, trimming spaces and capping the length', () => {
    const sim = grassSim(1);
    const id = hire(sim, StaffKind.Handyman);

    sim.enqueue({
      type: 'renameStaff',
      staffId: id,
      name: '  Gus   the  Great  ' + 'x'.repeat(40),
    });
    sim.step();

    const name = sim.world.staffNames.get(id) ?? '';
    expect(name.startsWith('Gus the Great')).toBe(true);
    expect(name.length).toBe(MAX_STAFF_NAME_LENGTH);
  });

  it('removes the name when renamed to blank, and when the staff member is fired', () => {
    const sim = grassSim(2);
    const id = hire(sim, StaffKind.Mechanic);
    sim.enqueue({ type: 'renameStaff', staffId: id, name: 'Ada' });
    sim.step();
    sim.enqueue({ type: 'renameStaff', staffId: id, name: '   ' });
    sim.step();
    expect(sim.world.staffNames.has(id)).toBe(false);

    sim.enqueue({ type: 'renameStaff', staffId: id, name: 'Ada' });
    sim.enqueue({ type: 'fireStaff', staffId: id });
    sim.step();
    expect(sim.world.staffNames.has(id)).toBe(false);
    expect(sim.world.staff.count).toBe(0);
  });
});

describe('flower beds', () => {
  it('plants a flower bed on grass for a one-off charge', () => {
    const sim = grassSim(3);
    const before = sim.world.economy.cash;

    sim.enqueue({ type: 'setFlowerBed', x: 4, y: 4, enabled: true });
    sim.step();

    expect(sim.world.grounds[sim.world.map.index(4, 4)] & FLOWER_BED).toBe(FLOWER_BED);
    expect(sim.world.economy.cash).toBe(before - FLOWER_BED_COST_CENTS);
    expect(sim.world.economy.monthlyTotals[LedgerCategory.Landscaping]).toBeLessThan(0);
  });

  it('refuses a flower bed on a path or when the park cannot pay for it', () => {
    const sim = grassSim(4);
    placePath(sim.world.map, { x: 4, y: 4, z: 2 });
    sim.enqueue({ type: 'setFlowerBed', x: 4, y: 4, enabled: true });
    sim.step();
    expect(sim.world.grounds[sim.world.map.index(4, 4)] & FLOWER_BED).toBe(0);

    sim.world.economy.cash = FLOWER_BED_COST_CENTS - 1;
    sim.enqueue({ type: 'setFlowerBed', x: 6, y: 6, enabled: true });
    sim.step();
    expect(sim.world.grounds[sim.world.map.index(6, 6)] & FLOWER_BED).toBe(0);
  });
});

describe('staff care determinism', () => {
  function runCare(seed: number): number {
    const sim = grassSim(seed, 24);
    const w = sim.world;
    for (let x = 4; x <= 18; x++) placePath(w.map, { x, y: 10, z: 2 });
    setPathAddition(w.map, 9, 10, PathAddition.Bench);
    setPathAddition(w.map, 12, 10, PathAddition.Shelter);
    sim.enqueue({ type: 'setFlowerBed', x: 9, y: 9, enabled: true });
    sim.enqueue({ type: 'setFlowerBed', x: 14, y: 11, enabled: true });
    sim.enqueue({ type: 'setParkEntrance', x: 4, y: 10 });
    for (const kind of [StaffKind.Handyman, StaffKind.Mechanic, StaffKind.Security]) {
      sim.enqueue({ type: 'hireStaff', kind });
    }
    sim.enqueue({ type: 'spawnGuests', count: 40 });
    dropLitter(w, 8, 10, LitterKind.Trash);
    for (let tick = 0; tick < GROUNDS_GROW_INTERVAL * 3; tick++) sim.step();
    return hashWorld(w);
  }

  it('produces the same world from the same seed and commands', () => {
    expect(runCare(21)).toBe(runCare(21));
  });

  it('survives a save and load with names and grounds intact', () => {
    const sim = grassSim(5);
    const id = hire(sim, StaffKind.Handyman);
    sim.enqueue({ type: 'renameStaff', staffId: id, name: 'Bea' });
    sim.enqueue({ type: 'setFlowerBed', x: 3, y: 3, enabled: true });
    sim.step();
    for (let i = 0; i < 50; i++) sim.step();

    const loaded = deserialize(serialize(sim.world));

    expect(loaded.staffNames.get(id)).toBe('Bea');
    expect(hashWorld(loaded)).toBe(hashWorld(sim.world));
  });
});

describe('security guards', () => {
  it('wander their patrol rather than standing still', () => {
    const sim = grassSim(6, 16);
    for (let x = 2; x <= 13; x++) placePath(sim.world.map, { x, y: 8, z: 2 });
    hire(sim, StaffKind.Security);
    const w = sim.world;
    const startX = w.staff.cols.x[0];
    const startY = w.staff.cols.y[0];

    for (let tick = 0; tick < 400; tick++) sim.step();

    expect(w.staff.cols.x[0] !== startX || w.staff.cols.y[0] !== startY).toBe(true);
  });
});

/** Long enough for a wandering handyman to have picked a queue tile as a destination. */
const WANDER_WARM_UP_TICKS = 6000;
/** A walking handyman crosses a tile in well under this; a frozen one never leaves it. */
const LONGEST_STAY_TICKS = 600;

describe('handymen wandering beside queues', () => {
  it.each([1, 2])(
    'keep walking instead of freezing on a queue line they cannot enter (seed %i)',
    (seed) => {
      const sim = grassSim(seed, 24);
      const map = sim.world.map;
      for (let x = 2; x <= 21; x++) placePath(map, { x, y: 12, z: 2 });
      for (let y = 2; y <= 10; y++)
        for (let x = 2; x <= 21; x++) placePath(map, { x, y, z: 2, queue: true });
      hire(sim, StaffKind.Handyman);
      const w = sim.world;
      for (let tick = 0; tick < WANDER_WARM_UP_TICKS; tick++) sim.step();

      let tile = -1;
      let stay = 0;
      let longestStay = 0;
      for (let tick = 0; tick < 2000; tick++) {
        sim.step();
        const now = map.index(
          (w.staff.cols.x[0] / TILE_UNITS) | 0,
          (w.staff.cols.y[0] / TILE_UNITS) | 0,
        );
        stay = now === tile ? stay + 1 : 0;
        tile = now;
        longestStay = Math.max(longestStay, stay);
      }

      expect(longestStay).toBeLessThan(LONGEST_STAY_TICKS);
    },
  );
});

describe('patrol masks', () => {
  it('keeps painted tiles private to the worker who receives them', () => {
    const sim = grassSim(7, 32);
    const first = hire(sim, StaffKind.Mechanic);
    const second = hire(sim, StaffKind.Mechanic);

    expect(setStaffPatrolTile(sim.world, first, 2, 3, true)).toBe(true);
    expect(setStaffPatrolTile(sim.world, second, 10, 3, true)).toBe(true);

    expect(staffPatrolTileEnabled(sim.world, first, 2, 3)).toBe(true);
    expect(staffPatrolTileEnabled(sim.world, first, 10, 3)).toBe(false);
    expect(staffPatrolTileEnabled(sim.world, second, 10, 3)).toBe(true);
    expect(staffPatrolTileEnabled(sim.world, second, 2, 3)).toBe(false);
  });
});
