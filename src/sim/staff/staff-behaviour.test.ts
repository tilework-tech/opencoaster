import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { TILE_UNITS } from '../core/constants';
import { OWNED, Surface } from '../map/tile-map';
import { PathAddition, placePath, setPathAddition } from '../map/paths';
import { dropLitter, LitterKind } from '../guests/litter-store';
import { GuestState } from '../guests/guest-store';
import {
  FLOWER_BED,
  FLOWER_BED_THIRSTY,
  MOW_THRESHOLD,
  OVERGROWTH_MASK,
  OVERGROWTH_MAX,
} from './grounds';
import { STAFF_ENERGY, staffStepUnits, SECURITY_CROWD_COUNT } from './staff-system';
import {
  MOW_TILE_DELAY,
  setStaffOrder,
  spawnStaff,
  StaffKind,
  StaffOrder,
  staffOrdersForKind,
} from './staff-store';
import { staffSystem } from './staff-system';

const FULL_BIN_CORNER = 0b11111100;
const PARTLY_FILLED_BIN = 0b11111110;

function lineWorld(seed: number, length = 12) {
  const sim = new Simulation({ seed, width: 24, height: 16 });
  sim.world.map.terrain.fill(Surface.Grass);
  sim.world.map.fillFlat(2);
  sim.world.map.ownership.fill(OWNED);
  for (let x = 2; x < 2 + length; x++) placePath(sim.world.map, { x, y: 6, z: 2 });
  return sim;
}

function hireHandyman(sim: Simulation, tileX = 6, mowTimeout = MOW_TILE_DELAY): number {
  spawnStaff(sim.world, StaffKind.Handyman);
  const slot = sim.world.staff.count - 1;
  sim.world.staff.cols.x[slot] = tileX * TILE_UNITS + 128;
  sim.world.staff.cols.y[slot] = 6 * TILE_UNITS + 128;
  sim.world.staff.cols.targetX[slot] = tileX;
  sim.world.staff.cols.targetY[slot] = 6;
  sim.world.staff.cols.mowTimeout[slot] = mowTimeout;
  return slot;
}

function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

describe('handyman statistics', () => {
  it('counts each swept piece of litter, mown lawn, watered bed and emptied bin', () => {
    const sim = lineWorld(3);
    const w = sim.world;
    const slot = hireHandyman(sim);
    dropLitter(w, 6, 6, LitterKind.Trash);
    w.grounds[w.map.index(6, 7)] = 12;
    w.grounds[w.map.index(7, 5)] = FLOWER_BED | FLOWER_BED_THIRSTY;
    setPathAddition(w.map, 8, 6, PathAddition.Bin);
    w.map.elData[w.map.pathElement(w.map.index(8, 6), -1)] = FULL_BIN_CORNER;

    run(sim, 1500);

    expect(w.staff.cols.sweeps[slot]).toBe(1);
    expect(w.staff.cols.lawnsMown[slot]).toBe(1);
    expect(w.staff.cols.gardensWatered[slot]).toBe(1);
    expect(w.staff.cols.binsEmptied[slot]).toBe(1);
    expect(w.staff.cols.ridesFixed[slot]).toBe(0);
  });
});

function completionOrder(sim: Simulation, slot: number, ticks: number): string[] {
  const cols = sim.world.staff.cols;
  const finished: string[] = [];
  const seen = {
    sweeps: cols.sweeps[slot],
    lawnsMown: cols.lawnsMown[slot],
    binsEmptied: cols.binsEmptied[slot],
    gardensWatered: cols.gardensWatered[slot],
  };
  for (let i = 0; i < ticks; i++) {
    sim.step();
    for (const key of Object.keys(seen) as (keyof typeof seen)[]) {
      if (cols[key][slot] > seen[key]) {
        seen[key] = cols[key][slot];
        finished.push(key);
      }
    }
  }
  return finished;
}

describe('handyman task priority', () => {
  it('mows, then empties a full bin, then waters', () => {
    const sim = lineWorld(5);
    const w = sim.world;
    const slot = hireHandyman(sim, 6);
    w.grounds[w.map.index(6, 7)] = 12;
    setPathAddition(w.map, 6, 6, PathAddition.Bin);
    w.map.elData[w.map.pathElement(w.map.index(6, 6), -1)] = FULL_BIN_CORNER;
    w.grounds[w.map.index(5, 5)] = FLOWER_BED | FLOWER_BED_THIRSTY;

    expect(completionOrder(sim, slot, 1500)).toEqual([
      'lawnsMown',
      'binsEmptied',
      'gardensWatered',
    ]);
  });

  it('sweeps litter before mowing, and mows only after twelve more tile steps', () => {
    const sim = lineWorld(6);
    const w = sim.world;
    const slot = hireHandyman(sim, 6);
    dropLitter(w, 6, 6, LitterKind.Trash);
    w.grounds[w.map.index(6, 7)] = 12;

    expect(completionOrder(sim, slot, 900)).toEqual(['sweeps']);
    expect(completionOrder(sim, slot, 3000)).toEqual(['lawnsMown']);
  });
});

describe('bins', () => {
  it('empties a bin only once one of its sides is completely full', () => {
    const sim = lineWorld(7);
    const w = sim.world;
    const slot = hireHandyman(sim);
    setPathAddition(w.map, 8, 6, PathAddition.Bin);
    const element = w.map.pathElement(w.map.index(8, 6), -1);
    w.map.elData[element] = PARTLY_FILLED_BIN;

    run(sim, 600);
    expect(w.map.elData[element] & 0xff).toBe(PARTLY_FILLED_BIN);
    expect(w.staff.cols.binsEmptied[slot]).toBe(0);

    w.map.elData[element] = FULL_BIN_CORNER;
    run(sim, 600);
    expect(w.map.elData[element] & 0xff).toBe(0xff);
    expect(w.staff.cols.binsEmptied[slot]).toBe(1);
  });
});

describe('mowing', () => {
  it('waits twelve tile steps after other work before mowing', () => {
    expect(MOW_TILE_DELAY).toBe(12);
    const sim = lineWorld(9);
    const w = sim.world;
    const slot = hireHandyman(sim, 6, 0);
    w.grounds[w.map.index(6, 7)] = MOW_THRESHOLD + 2;

    // Twelve tiles of 256 units at three units a tick take 1,024 ticks.
    run(sim, 800);
    expect(w.staff.cols.lawnsMown[slot]).toBe(0);

    run(sim, 2500);
    expect(w.staff.cols.lawnsMown[slot]).toBe(1);
  });

  it('ignores grass shorter than the mowing threshold', () => {
    const sim = lineWorld(10);
    const w = sim.world;
    sim.world.tick = 1;
    const slot = hireHandyman(sim);
    const lawn = w.map.index(6, 7);
    w.grounds[lawn] = MOW_THRESHOLD - 1;

    run(sim, 1000);

    expect(w.grounds[lawn] & OVERGROWTH_MASK).toBe(MOW_THRESHOLD - 1);
    expect(w.staff.cols.lawnsMown[slot]).toBe(0);
    expect(OVERGROWTH_MAX).toBeGreaterThan(MOW_THRESHOLD);
  });

  it('keeps mowing and watering as separate orders', () => {
    expect(staffOrdersForKind(StaffKind.Handyman)).toEqual([
      StaffOrder.SweepPaths,
      StaffOrder.EmptyBins,
      StaffOrder.WaterGardens,
      StaffOrder.MowGrass,
    ]);
    const sim = lineWorld(11);
    const w = sim.world;
    sim.world.tick = 1;
    const slot = hireHandyman(sim);
    const id = w.staff.slotToId[slot];
    const bed = w.map.index(7, 5);
    w.grounds[w.map.index(6, 7)] = 12;
    w.grounds[bed] = FLOWER_BED | FLOWER_BED_THIRSTY;
    setStaffOrder(w, id, 'mow-grass', false);

    run(sim, 1000);
    expect(w.staff.cols.lawnsMown[slot]).toBe(0);
    expect(w.grounds[bed] & FLOWER_BED_THIRSTY).toBe(0);

    setStaffOrder(w, id, 'mow-grass', true);
    setStaffOrder(w, id, 'water-gardens', false);
    w.grounds[bed] = FLOWER_BED | FLOWER_BED_THIRSTY;
    run(sim, 900);
    expect(w.staff.cols.lawnsMown[slot]).toBe(1);
    expect(w.grounds[bed] & FLOWER_BED_THIRSTY).toBe(FLOWER_BED_THIRSTY);
  });
});

describe('idle wandering and speed', () => {
  it('keeps an idle handyman without a patrol area walking the paths', () => {
    const sim = lineWorld(13, 14);
    const w = sim.world;
    hireHandyman(sim, 4);
    const visited = new Set<number>();
    for (let i = 0; i < 1500; i++) {
      sim.step();
      visited.add(Math.floor(w.staff.cols.x[0] / TILE_UNITS));
    }
    expect(visited.size).toBeGreaterThanOrEqual(6);
    for (const x of visited) expect(x).toBeGreaterThanOrEqual(2);
  });

  it('walks at the fixed hire energy of 96: three world units per tick', () => {
    expect(STAFF_ENERGY).toBe(96);
    expect(staffStepUnits(STAFF_ENERGY, false)).toBe(48);
    expect(staffStepUnits(STAFF_ENERGY, true)).toBe(24);
  });

  it('moves a security guard half as fast while 20 guests walk within three tiles', () => {
    expect(SECURITY_CROWD_COUNT).toBe(20);
    const firstStep = (guests: number): number => {
      const sim = lineWorld(14, 20);
      const w = sim.world;
      spawnStaff(w, StaffKind.Security);
      const startX = 3 * TILE_UNITS + 128;
      w.staff.cols.x[0] = startX;
      w.staff.cols.y[0] = 6 * TILE_UNITS + 128;
      for (let i = 0; i < guests; i++) {
        const id = w.guests.spawn();
        const guest = w.guests.idToSlot[id];
        w.guests.cols.x[guest] = 4 * TILE_UNITS + 128;
        w.guests.cols.y[guest] = 6 * TILE_UNITS + 128;
        w.guests.cols.z[guest] = w.staff.cols.z[0];
        w.guests.cols.state[guest] = GuestState.Wandering;
      }
      w.staff.cols.targetX[0] = 15;
      w.staff.cols.targetY[0] = 6;
      w.tick = 384;
      staffSystem.update(w);
      return (
        Math.abs(w.staff.cols.x[0] - startX) + Math.abs(w.staff.cols.y[0] - (6 * TILE_UNITS + 128))
      );
    };
    expect(firstStep(0)).toBe(48);
    expect(firstStep(SECURITY_CROWD_COUNT - 1)).toBe(48);
    expect(firstStep(SECURITY_CROWD_COUNT)).toBe(24);
  });
});
