import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { Surface } from '../map/tile-map';
import { placePath, setPathAddition, PathAddition } from '../map/paths';
import { RidePhase, RideState } from '../rides/ride-store';
import { createRide, triggerRideBreakdown, isRideInspectionDue } from '../rides/ride-operations';
import { RideType } from '../rides/ride-types';
import { FLOWER_BED, FLOWER_BED_THIRSTY, GROUNDS_GROW_INTERVAL, OVERGROWTH_MASK } from './grounds';
import { StaffKind, spawnStaff } from './staff-store';
import { staffSystem } from './staff-system';
import { flatWorld, layPath, row } from '../integration/fixtures';

function handymanWorld(seed: number) {
  const sim = new Simulation({ seed, width: 16, height: 16 });
  sim.world.map.terrain.fill(Surface.Grass);
  sim.world.map.fillFlat(2);
  for (let x = 4; x <= 10; x++) placePath(sim.world.map, { x, y: 6, z: 2 });
  spawnStaff(sim.world, StaffKind.Handyman);
  sim.world.staff.cols.x[0] = 6 * 256 + 128;
  sim.world.staff.cols.y[0] = 6 * 256 + 128;
  return sim;
}

describe('handyman garden work', () => {
  it('waters a thirsty flower bed from the path beside it', () => {
    const sim = handymanWorld(11);
    const w = sim.world;
    sim.enqueue({ type: 'setFlowerBed', x: 6, y: 7, enabled: true });
    sim.step();
    const bed = w.map.index(6, 7);
    expect(w.grounds[bed] & FLOWER_BED).toBe(FLOWER_BED);
    w.grounds[bed] |= FLOWER_BED_THIRSTY;

    for (let i = 0; i < 40; i++) sim.step();

    expect(w.grounds[bed] & FLOWER_BED_THIRSTY).toBe(0);
  });

  it('mows grass that has grown tall next to the path', () => {
    const sim = handymanWorld(12);
    const w = sim.world;
    const grass = w.map.index(6, 7);
    w.grounds[grass] = 12;

    for (let i = 0; i < 40; i++) sim.step();

    expect(w.grounds[grass] & OVERGROWTH_MASK).toBe(0);
  });

  it('leaves short grass and flower beds that are not thirsty alone', () => {
    const sim = handymanWorld(13);
    const w = sim.world;
    sim.enqueue({ type: 'setFlowerBed', x: 6, y: 7, enabled: true });
    sim.step();
    const bed = w.map.index(6, 7);
    const shortGrass = w.map.index(6, 5);
    w.grounds[shortGrass] = 3;

    for (let i = 0; i < 40; i++) sim.step();

    expect(w.grounds[shortGrass]).toBe(3);
    expect(w.grounds[bed] & FLOWER_BED_THIRSTY).toBe(0);
  });

  it('grows grass and dries flower beds on the growth interval', () => {
    const sim = new Simulation({ seed: 14, width: 8, height: 8 });
    const w = sim.world;
    w.map.terrain.fill(Surface.Grass);
    w.map.fillFlat(2);
    sim.enqueue({ type: 'setFlowerBed', x: 3, y: 3, enabled: true });
    sim.step();
    const grass = w.map.index(0, 0);
    const bed = w.map.index(3, 3);
    const before = w.grounds[grass] & OVERGROWTH_MASK;

    for (let i = 0; i < 8; i++) {
      w.tick = GROUNDS_GROW_INTERVAL * (41 + i);
      sim.step();
    }

    expect(w.grounds[grass] & OVERGROWTH_MASK).toBeGreaterThan(before);
    expect(w.grounds[bed] & FLOWER_BED_THIRSTY).toBe(FLOWER_BED_THIRSTY);
  });
});

describe('mechanic response', () => {
  it('repairs a broken coaster without a close and retest', () => {
    const w = flatWorld(16, 3);
    layPath(w, [...row(6, 4, 10), [7, 7], [7, 8]]);
    const rideId = createRide(w, RideType.MerryGoRound, 8, 8);
    const slot = w.rides.idToSlot[rideId];
    w.rides.cols.state[slot] = RideState.Open;
    w.rides.cols.phase[slot] = RidePhase.Waiting;
    w.rides.cols.queueConnected[slot] = 1;
    triggerRideBreakdown(w, rideId);
    spawnStaff(w, StaffKind.Mechanic);
    w.staff.cols.x[0] = 7 * 256 + 128;
    w.staff.cols.y[0] = 8 * 256 + 128;

    staffSystem.update(w);

    expect(w.rides.cols.state[slot]).toBe(RideState.Open);
    expect(w.rides.cols.phase[slot]).toBe(RidePhase.Waiting);
  });

  it('services a broken ride before a nearer ride that only needs its inspection', () => {
    const w = flatWorld(20, 4);
    layPath(w, row(7, 2, 16));
    const dueId = createRide(w, RideType.MerryGoRound, 4, 8);
    const brokenId = createRide(w, RideType.MerryGoRound, 12, 8);
    for (const id of [dueId, brokenId]) {
      const slot = w.rides.idToSlot[id];
      w.rides.cols.state[slot] = RideState.Open;
      w.rides.cols.phase[slot] = RidePhase.Waiting;
      w.rides.cols.queueConnected[slot] = 1;
    }
    w.tick = 200_000;
    w.rides.cols.lastInspectionTick[w.rides.idToSlot[dueId]] = 0;
    triggerRideBreakdown(w, brokenId);
    expect(isRideInspectionDue(w, dueId)).toBe(true);
    spawnStaff(w, StaffKind.Mechanic);
    w.staff.cols.x[0] = 2 * 256 + 128;
    w.staff.cols.y[0] = 7 * 256 + 128;

    for (
      let i = 0;
      i < 200 && w.rides.cols.state[w.rides.idToSlot[brokenId]] !== RideState.Open;
      i++
    ) {
      w.tick += 16;
      staffSystem.update(w);
    }

    expect(w.rides.cols.state[w.rides.idToSlot[brokenId]]).toBe(RideState.Open);
    expect(w.rides.cols.lastInspectionTick[w.rides.idToSlot[dueId]]).toBe(0);
  });
});

describe('path additions', () => {
  it('places a rain shelter on a path', () => {
    const w = flatWorld(8, 2);
    layPath(w, row(4, 2, 5));
    expect(setPathAddition(w.map, 3, 4, PathAddition.Shelter)).toBe(true);
  });
});
