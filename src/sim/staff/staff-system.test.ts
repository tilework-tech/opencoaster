import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { hashWorld } from '../core/hash';
import { TICKS_PER_WEEK } from '../economy/calendar';
import { placePath, setPathAddition, PathAddition } from '../map/paths';
import { RidePhase, RideState } from '../rides/ride-store';
import { createRide } from '../rides/ride-operations';
import {
  MechanicStatus,
  getRideMechanicStatus,
  triggerRideBreakdown,
} from '../rides/ride-maintenance';
import { RideType } from '../rides/ride-types';
import {
  StaffKind,
  StaffOrder,
  setStaffKindPatrolTile,
  setStaffPatrolTile,
  spawnStaff,
} from './staff-store';
import { dropLitter, LitterKind } from '../guests/litter-store';
import { staffSystem } from './staff-system';
import { isReachable } from '../pathfinding';
import { OWNED } from '../map/tile-map';

/** Runs staff updates on their 16-tick stride until `done`, standing in for the game loop. */
function workStaffUntil(world: Simulation['world'], done: () => boolean): void {
  for (let i = 0; i < 100 && !done(); i++) {
    staffSystem.update(world);
    world.tick += 16;
  }
}

describe('staff commands and work', () => {
  it('keeps handymen inside their own 4-by-4 patrol blocks while sweeping', () => {
    const sim = new Simulation({ seed: 36, width: 32, height: 16 });
    const world = sim.world;
    world.map.fillFlat(2);
    world.map.ownership.fill(OWNED);
    for (let x = 0; x <= 7; x++) placePath(world.map, { x, y: 8, z: 2 });
    spawnStaff(world, StaffKind.Handyman);
    spawnStaff(world, StaffKind.Handyman);
    const firstId = world.staff.slotToId[0];
    const secondId = world.staff.slotToId[1];
    world.staff.cols.x[0] = 2 * 256 + 128;
    world.staff.cols.y[0] = 8 * 256 + 128;
    world.staff.cols.x[1] = 5 * 256 + 128;
    world.staff.cols.y[1] = 8 * 256 + 128;
    world.staff.cols.targetX[0] = 2;
    world.staff.cols.targetY[0] = 8;
    world.staff.cols.targetX[1] = 5;
    world.staff.cols.targetY[1] = 8;
    expect(setStaffPatrolTile(world, firstId, 2, 8, true)).toBe(true);
    expect(setStaffPatrolTile(world, secondId, 5, 8, true)).toBe(true);
    world.staff.cols.orderFlags[0] &= ~(1 << StaffOrder.SweepPaths);
    dropLitter(world, 3, 8, LitterKind.Trash);

    for (let tick = 0; tick < 500; tick++) {
      world.tick = tick;
      staffSystem.update(world);
    }

    expect(world.litter.count).toBe(1);
    expect(world.staff.cols.sweeps[1]).toBe(0);
    world.staff.cols.orderFlags[0] |= 1 << StaffOrder.SweepPaths;
    world.staff.cols.orderFlags[1] &= ~(1 << StaffOrder.SweepPaths);
    dropLitter(world, 5, 8, LitterKind.Trash);

    for (let tick = 500; tick < 1_500; tick++) {
      world.tick = tick;
      staffSystem.update(world);
    }

    expect(world.litter.count).toBe(1);
    expect(world.staff.cols.sweeps[0]).toBe(1);
    expect(world.staff.cols.sweeps[1]).toBe(0);
    expect((world.staff.cols.x[0] / 256) | 0).toBeGreaterThanOrEqual(0);
    expect((world.staff.cols.x[0] / 256) | 0).toBeLessThanOrEqual(3);
    expect((world.staff.cols.x[1] / 256) | 0).toBeGreaterThanOrEqual(4);
    expect((world.staff.cols.x[1] / 256) | 0).toBeLessThanOrEqual(7);

    world.staff.cols.orderFlags[1] |= 1 << StaffOrder.SweepPaths;
    for (let tick = 1_500; tick < 2_500; tick++) {
      world.tick = tick;
      staffSystem.update(world);
    }
    expect(world.litter.count).toBe(0);
    expect(world.staff.cols.sweeps[1]).toBe(1);
  });

  it('releases a fired worker patrol area for a newly hired worker', () => {
    const sim = new Simulation({ seed: 37, width: 32, height: 16 });
    const world = sim.world;
    world.map.fillFlat(2);
    world.map.ownership.fill(OWNED);
    for (let x = 0; x <= 23; x++) placePath(world.map, { x, y: 8, z: 2 });
    spawnStaff(world, StaffKind.Handyman);
    const firedId = world.staff.slotToId[0];
    expect(setStaffPatrolTile(world, firedId, 17, 8, true)).toBe(true);
    expect(setStaffPatrolTile(world, firedId, 21, 8, true)).toBe(true);
    const releasedArea = world.staff.cols.patrolArea[0];
    expect(releasedArea).toBeGreaterThan(0);

    sim.enqueue({ type: 'fireStaff', staffId: firedId });
    sim.step();
    expect(world.staff.count).toBe(0);
    expect(spawnStaff(world, StaffKind.Handyman)).toBe(true);
    const replacementId = world.staff.slotToId[0];
    world.staff.cols.x[0] = 21 * 256 + 128;
    world.staff.cols.y[0] = 8 * 256 + 128;
    world.staff.cols.targetX[0] = 21;
    world.staff.cols.targetY[0] = 8;
    expect(setStaffPatrolTile(world, replacementId, 21, 8, true)).toBe(true);
    expect(world.staff.cols.patrolArea[0]).toBe(releasedArea);
    dropLitter(world, 19, 8, LitterKind.Trash);

    for (let tick = 0; tick < 500; tick++) {
      world.tick = tick;
      staffSystem.update(world);
    }

    expect(world.litter.count).toBe(1);
    expect(world.staff.cols.sweeps[0]).toBe(0);
  });

  it('does not dispatch a handyman to litter outside the three-tile sweep radius', () => {
    const sim = new Simulation({ seed: 18, width: 16, height: 16 });
    const world = sim.world;
    world.map.fillFlat(2);
    world.map.ownership.fill(OWNED);
    for (let x = 8; x <= 12; x++) placePath(world.map, { x, y: 8, z: 2 });
    spawnStaff(world, StaffKind.Handyman);
    world.staff.cols.x[0] = 8 * 256 + 128;
    world.staff.cols.y[0] = 8 * 256 + 128;
    world.staff.cols.z[0] = world.map.heightAt(world.staff.cols.x[0], world.staff.cols.y[0]);
    world.staff.cols.targetX[0] = 8;
    world.staff.cols.targetY[0] = 8;
    dropLitter(world, 12, 8, LitterKind.Trash);
    expect(world.litter.count).toBe(1);

    for (let tick = 0; tick < 2_000; tick++) {
      world.tick = tick;
      staffSystem.update(world);
    }

    expect(world.litter.count).toBe(1);
  });

  it('sweeps reachable litter inside the three-tile radius', () => {
    const sim = new Simulation({ seed: 21, width: 16, height: 16 });
    const world = sim.world;
    world.map.fillFlat(2);
    world.map.ownership.fill(OWNED);
    for (let x = 8; x <= 10; x++) placePath(world.map, { x, y: 8, z: 2 });
    spawnStaff(world, StaffKind.Handyman);
    world.staff.cols.x[0] = 8 * 256 + 128;
    world.staff.cols.y[0] = 8 * 256 + 128;
    world.staff.cols.z[0] = world.map.heightAt(world.staff.cols.x[0], world.staff.cols.y[0]);
    dropLitter(world, 10, 8, LitterKind.Trash);

    for (let tick = 0; tick < 2_000 && world.litter.count > 0; tick++) {
      world.tick = tick;
      staffSystem.update(world);
    }

    expect(world.litter.count).toBe(0);
  });

  it('treats vertical distance as four tiles per height level when finding litter', () => {
    const sim = new Simulation({ seed: 19, width: 16, height: 16 });
    const world = sim.world;
    world.map.fillFlat(2);
    world.map.ownership.fill(OWNED);
    placePath(world.map, { x: 8, y: 8, z: 2 });
    spawnStaff(world, StaffKind.Handyman);
    world.staff.cols.x[0] = 7 * 256 + 128;
    world.staff.cols.y[0] = 8 * 256 + 128;
    placePath(world.map, { x: 7, y: 8, z: 2 });
    world.staff.cols.z[0] = world.map.heightAt(world.staff.cols.x[0], world.staff.cols.y[0]);
    world.staff.cols.targetX[0] = 7;
    world.staff.cols.targetY[0] = 8;
    dropLitter(world, 8, 8, LitterKind.Trash);
    world.litter.cols.z[0] += 4 * 64;

    for (let tick = 0; tick < 2_000; tick++) {
      world.tick = tick;
      staffSystem.update(world);
    }

    expect(world.litter.count).toBe(1);
  });

  it('counts completed sweeps and repeats the same seeded work sequence', () => {
    const run = () => {
      const sim = new Simulation({ seed: 20, width: 16, height: 16 });
      const world = sim.world;
      world.map.fillFlat(2);
      world.map.ownership.fill(OWNED);
      placePath(world.map, { x: 8, y: 8, z: 2 });
      spawnStaff(world, StaffKind.Handyman);
      world.staff.cols.x[0] = 8 * 256 + 128;
      world.staff.cols.y[0] = 8 * 256 + 128;
      world.staff.cols.z[0] = world.map.heightAt(world.staff.cols.x[0], world.staff.cols.y[0]);
      dropLitter(world, 8, 8, LitterKind.Trash);
      for (let tick = 0; tick < 1600 && world.litter.count > 0; tick += 16) {
        world.tick = tick;
        staffSystem.update(world);
      }
      return sim;
    };
    const first = run();
    const second = run();

    expect(first.world.litter.count).toBe(0);
    expect(first.world.staff.cols.sweeps[0]).toBe(1);
    expect(hashWorld(first.world)).toBe(hashWorld(second.world));
  });

  it('hires and fires staff while updating weekly payroll', () => {
    const sim = new Simulation({ seed: 8, width: 16, height: 16 });
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
    sim.step();

    expect(sim.world.staff.count).toBe(1);
    expect(sim.world.economy.inputs.wageBillPerWeek).toBeGreaterThan(0);

    const beforePayday = sim.world.economy.cash;
    sim.world.economy.loan = 0;
    sim.world.tick = TICKS_PER_WEEK;
    sim.step();
    expect(sim.world.economy.cash).toBeLessThan(beforePayday);
    sim.enqueue({ type: 'fireStaff', staffId: sim.world.staff.slotToId[0] });
    sim.step();
    expect(sim.world.staff.count).toBe(0);
    expect(sim.world.economy.inputs.wageBillPerWeek).toBe(0);
  });

  it('uses a patrol area to keep a handyman on its connected paths', () => {
    const sim = new Simulation({ seed: 2, width: 16, height: 16 });
    const w = sim.world;
    w.map.fillFlat(2);
    w.map.ownership.fill(OWNED);
    for (let x = 4; x <= 10; x++) sim.enqueue({ type: 'placePath', x, y: 6, z: 2 });
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
    sim.step();
    const staffId = w.staff.slotToId[0];
    for (let x = 4; x <= 7; x++)
      sim.enqueue({ type: 'setStaffPatrolTile', staffId, x, y: 6, enabled: true });
    sim.step();
    w.staff.cols.x[0] = 4 * 256 + 128;
    w.staff.cols.y[0] = 6 * 256 + 128;
    w.staff.cols.z[0] = w.map.heightAt(w.staff.cols.x[0], w.staff.cols.y[0]);
    dropLitter(w, 7, 6, LitterKind.Trash);
    dropLitter(w, 10, 6, LitterKind.Trash);
    for (let i = 0; i < 300; i++) {
      sim.step();
      const tileX = Math.floor(w.staff.cols.x[0] / 256);
      const tileY = Math.floor(w.staff.cols.y[0] / 256);
      expect(tileY).toBe(6);
      expect(tileX).toBeGreaterThanOrEqual(4);
      expect(tileX).toBeLessThanOrEqual(7);
    }

    expect(w.litter.count).toBe(1);
    expect(w.litter.cols.x[0]).toBe(10 * 256 + 128);
  });

  it('chooses reachable litter over a closer item on a disconnected path', () => {
    const sim = new Simulation({ seed: 9, width: 16, height: 16 });
    const world = sim.world;
    world.map.fillFlat(2);
    world.map.ownership.fill(OWNED);
    for (let x = 4; x <= 10; x++) placePath(world.map, { x, y: 6, z: 2 });
    placePath(world.map, { x: 5, y: 8, z: 2 });
    placePath(world.map, { x: 5, y: 9, z: 2 });
    spawnStaff(world, StaffKind.Handyman);
    world.staff.cols.x[0] = 4 * 256 + 128;
    world.staff.cols.y[0] = 6 * 256 + 128;
    world.staff.cols.z[0] = world.map.heightAt(world.staff.cols.x[0], world.staff.cols.y[0]);
    dropLitter(world, 5, 8, LitterKind.Trash);
    dropLitter(world, 7, 6, LitterKind.Trash);

    for (let tick = 0; tick < 500; tick++) sim.step();

    expect(world.litter.count).toBe(1);
    expect(world.litter.cols.x[0]).toBe(5 * 256 + 128);
    expect(world.litter.cols.y[0]).toBe(8 * 256 + 128);
  });

  it('selects and empties a reachable bin instead of a closer disconnected bin', () => {
    const sim = new Simulation({ seed: 35, width: 16, height: 16 });
    const world = sim.world;
    world.map.fillFlat(2);
    for (let x = 4; x <= 10; x++) placePath(world.map, { x, y: 6, z: 2 });
    placePath(world.map, { x: 5, y: 8, z: 2 });
    expect(setPathAddition(world.map, 5, 8, PathAddition.Bin)).toBe(true);
    expect(setPathAddition(world.map, 8, 6, PathAddition.Bin)).toBe(true);
    const disconnectedBin = world.map.pathElement(world.map.index(5, 8), -1);
    const reachableBin = world.map.pathElement(world.map.index(8, 6), -1);
    expect(isReachable(world, world.map.index(4, 6), world.map.index(5, 8))).toBe(false);
    expect(isReachable(world, world.map.index(4, 6), world.map.index(8, 6))).toBe(true);
    world.map.elData[disconnectedBin] = 4;
    world.map.elData[reachableBin] = 4;
    spawnStaff(world, StaffKind.Handyman);
    world.staff.cols.x[0] = 4 * 256 + 128;
    world.staff.cols.y[0] = 6 * 256 + 128;

    staffSystem.update(world);

    expect(world.staff.cols.targetX[0]).toBe(8);
    expect(world.staff.cols.targetY[0]).toBe(6);

    for (let tick = 0; tick < 500; tick++) sim.step();

    expect(world.map.elData[disconnectedBin]).toBe(4);
    expect(world.map.elData[reachableBin]).toBe(0xff);
  });

  it('sends a mechanic to a broken ride and restores its operation', () => {
    const sim = new Simulation({ seed: 3, width: 16, height: 16 });
    const world = sim.world;
    world.map.fillFlat(2);
    placePath(world.map, { x: 7, y: 8, z: 2 });
    const rideId = createRide(world, RideType.MerryGoRound, 8, 8);
    const rideSlot = world.rides.idToSlot[rideId];
    world.rides.cols.state[rideSlot] = RideState.Open;
    world.rides.cols.phase[rideSlot] = RidePhase.Waiting;
    world.rides.cols.queueConnected[rideSlot] = 1;
    expect(triggerRideBreakdown(world, rideId)).toBe(true);
    expect(spawnStaff(world, StaffKind.Mechanic)).toBe(true);
    world.staff.cols.x[0] = 7 * 256 + 128;
    world.staff.cols.y[0] = 8 * 256 + 128;

    workStaffUntil(world, () => world.rides.cols.state[rideSlot] === RideState.Open);

    expect(world.rides.cols.state[rideSlot]).toBe(RideState.Open);
    expect(world.rides.cols.phase[rideSlot]).toBe(RidePhase.Waiting);
  });

  it('shows a repair call, the mechanic heading to the ride, then the repair under way', () => {
    const sim = new Simulation({ seed: 3, width: 16, height: 16 });
    const world = sim.world;
    world.map.fillFlat(2);
    for (let x = 2; x <= 7; x++) placePath(world.map, { x, y: 8, z: 2 });
    const rideId = createRide(world, RideType.MerryGoRound, 8, 8);
    const rideSlot = world.rides.idToSlot[rideId];
    world.rides.cols.state[rideSlot] = RideState.Open;
    world.rides.cols.phase[rideSlot] = RidePhase.Waiting;
    world.rides.cols.queueConnected[rideSlot] = 1;
    expect(getRideMechanicStatus(world, rideId)).toBe(MechanicStatus.None);

    triggerRideBreakdown(world, rideId);
    expect(getRideMechanicStatus(world, rideId)).toBe(MechanicStatus.Calling);

    expect(spawnStaff(world, StaffKind.Mechanic)).toBe(true);
    world.staff.cols.x[0] = 2 * 256 + 128;
    world.staff.cols.y[0] = 8 * 256 + 128;
    staffSystem.update(world);
    world.tick += 16;
    expect(getRideMechanicStatus(world, rideId)).toBe(MechanicStatus.Heading);

    const seen = new Set<MechanicStatus>();
    workStaffUntil(world, () => {
      seen.add(getRideMechanicStatus(world, rideId));
      return world.rides.cols.state[rideSlot] === RideState.Open;
    });
    expect(seen.has(MechanicStatus.Fixing)).toBe(true);
    expect(getRideMechanicStatus(world, rideId)).toBe(MechanicStatus.None);
  });

  it('keeps a repair call unanswered when no mechanic is employed', () => {
    const sim = new Simulation({ seed: 3, width: 16, height: 16 });
    const world = sim.world;
    world.map.fillFlat(2);
    const rideId = createRide(world, RideType.MerryGoRound, 8, 8);
    world.rides.cols.state[world.rides.idToSlot[rideId]] = RideState.Open;
    triggerRideBreakdown(world, rideId);
    for (let i = 0; i < 20; i++) {
      staffSystem.update(world);
      world.tick += 16;
    }
    expect(getRideMechanicStatus(world, rideId)).toBe(MechanicStatus.Calling);
  });

  it('skips a disconnected broken ride and services a reachable repair call', () => {
    const sim = new Simulation({ seed: 31, width: 16, height: 16 });
    const world = sim.world;
    world.map.fillFlat(2);
    const unreachableId = createRide(world, RideType.MerryGoRound, 3, 3);
    const unreachableSlot = world.rides.idToSlot[unreachableId];
    world.rides.cols.state[unreachableSlot] = RideState.Open;
    triggerRideBreakdown(world, unreachableId);
    placePath(world.map, { x: 3, y: 4, z: 2 });
    placePath(world.map, { x: 3, y: 5, z: 2 });

    placePath(world.map, { x: 7, y: 8, z: 2 });
    expect(isReachable(world, world.map.index(7, 8), world.map.index(3, 4))).toBe(false);
    const reachableId = createRide(world, RideType.MerryGoRound, 8, 8);
    const reachableSlot = world.rides.idToSlot[reachableId];
    world.rides.cols.state[reachableSlot] = RideState.Open;
    world.rides.cols.phase[reachableSlot] = RidePhase.Waiting;
    world.rides.cols.queueConnected[reachableSlot] = 1;
    triggerRideBreakdown(world, reachableId);
    spawnStaff(world, StaffKind.Mechanic);
    world.staff.cols.x[0] = 7 * 256 + 128;
    world.staff.cols.y[0] = 8 * 256 + 128;

    workStaffUntil(world, () => world.rides.cols.state[reachableSlot] === RideState.Open);

    expect(world.rides.cols.state[unreachableSlot]).toBe(RideState.Broken);
    expect(world.rides.cols.state[reachableSlot]).toBe(RideState.Open);
  });

  it('gives entertainers their scheduled happiness boost at any staff id phase', () => {
    const sim = new Simulation({ seed: 32, width: 16, height: 16 });
    const world = sim.world;
    world.map.fillFlat(2);
    placePath(world.map, { x: 5, y: 5, z: 2 });
    const guestId = world.guests.spawn();
    const guestSlot = world.guests.idToSlot[guestId];
    world.guests.cols.x[guestSlot] = 5 * 256 + 128;
    world.guests.cols.y[guestSlot] = 5 * 256 + 128;
    world.guests.cols.happiness[guestSlot] = 100;
    world.guests.cols.happinessTarget[guestSlot] = 100;
    spawnStaff(world, StaffKind.Handyman);
    spawnStaff(world, StaffKind.Entertainer);
    world.staff.cols.x[1] = 5 * 256 + 128;
    world.staff.cols.y[1] = 5 * 256 + 128;
    world.tick = 79;

    staffSystem.update(world);

    expect(world.guests.cols.happiness[guestSlot]).toBe(101);
    expect(world.guests.cols.happinessTarget[guestSlot]).toBe(101);
  });

  it('limits an entertainer happiness boost to guests within two tiles', () => {
    const sim = new Simulation({ seed: 35, width: 16, height: 16 });
    const world = sim.world;
    world.map.fillFlat(2);
    placePath(world.map, { x: 5, y: 5, z: 2 });
    const nearbyId = world.guests.spawn();
    const nearbySlot = world.guests.idToSlot[nearbyId];
    world.guests.cols.x[nearbySlot] = 7 * 256 + 128;
    world.guests.cols.y[nearbySlot] = 7 * 256 + 128;
    world.guests.cols.happiness[nearbySlot] = 100;
    const distantId = world.guests.spawn();
    const distantSlot = world.guests.idToSlot[distantId];
    world.guests.cols.x[distantSlot] = 8 * 256 + 128;
    world.guests.cols.y[distantSlot] = 8 * 256 + 128;
    world.guests.cols.happiness[distantSlot] = 100;
    spawnStaff(world, StaffKind.Handyman);
    spawnStaff(world, StaffKind.Entertainer);
    world.staff.cols.x[1] = 5 * 256 + 128;
    world.staff.cols.y[1] = 5 * 256 + 128;
    world.tick = 79;

    staffSystem.update(world);

    expect(world.guests.cols.happiness[nearbySlot]).toBe(101);
    expect(world.guests.cols.happiness[distantSlot]).toBe(100);
  });

  it('keeps an unassigned handyman in place when there is no work', () => {
    const sim = new Simulation({ seed: 33, width: 16, height: 16 });
    const world = sim.world;
    world.map.fillFlat(2);
    for (let x = 4; x <= 10; x++) placePath(world.map, { x, y: 6, z: 2 });
    spawnStaff(world, StaffKind.Handyman);
    world.staff.cols.x[0] = 4 * 256 + 128;
    world.staff.cols.y[0] = 6 * 256 + 128;
    world.staff.cols.targetX[0] = 10;
    world.staff.cols.targetY[0] = 6;

    staffSystem.update(world);

    expect(world.staff.cols.x[0]).toBe(4 * 256 + 128);
  });

  it('brings a mechanic back into its patrol before servicing a reachable ride', () => {
    const sim = new Simulation({ seed: 34, width: 16, height: 16 });
    const world = sim.world;
    world.map.fillFlat(2);
    for (let x = 4; x <= 10; x++) placePath(world.map, { x, y: 8, z: 2 });
    for (let x = 4; x <= 8; x++) setStaffKindPatrolTile(world, StaffKind.Mechanic, x, 8, true);
    const rideId = createRide(world, RideType.MerryGoRound, 8, 7);
    const rideSlot = world.rides.idToSlot[rideId];
    world.rides.cols.state[rideSlot] = RideState.Open;
    world.rides.cols.phase[rideSlot] = RidePhase.Waiting;
    world.rides.cols.queueConnected[rideSlot] = 1;
    triggerRideBreakdown(world, rideId);
    spawnStaff(world, StaffKind.Mechanic);
    world.staff.cols.x[0] = 9 * 256 + 128;
    world.staff.cols.y[0] = 8 * 256 + 128;

    for (let tick = 0; tick < 600; tick++) sim.step();

    expect(world.rides.cols.state[rideSlot]).toBe(RideState.Open);
  });
});
