import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { TICKS_PER_WEEK } from '../economy/calendar';
import { LedgerCategory } from '../economy/ledger';
import { placePath, setPathAddition, PathAddition } from '../map/paths';
import { RidePhase, RideState } from '../rides/ride-store';
import { createRide, triggerRideBreakdown } from '../rides/ride-operations';
import { RideType } from '../rides/ride-types';
import { StaffKind, setStaffKindPatrolTile, spawnStaff } from './staff-store';
import { dropLitter, LitterKind } from '../guests/litter-store';
import { staffSystem } from './staff-system';
import { isReachable } from '../pathfinding';

describe('staff commands and work', () => {
  it('hires and fires staff while updating the weekly wage bill', () => {
    const sim = new Simulation({ seed: 8, width: 16, height: 16 });
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
    sim.step();

    expect(sim.world.staff.count).toBe(1);
    expect(sim.world.economy.inputs.wageBillPerWeek).toBeGreaterThan(0);

    const beforePayday = sim.world.economy.cash;
    sim.world.tick = TICKS_PER_WEEK;
    sim.step();
    expect(sim.world.economy.cash).toBeLessThan(beforePayday);
    expect(sim.world.economy.monthlyTotals[LedgerCategory.Wages]).toBeLessThan(0);

    sim.enqueue({ type: 'fireStaff', staffId: sim.world.staff.slotToId[0] });
    sim.step();
    expect(sim.world.staff.count).toBe(0);
    expect(sim.world.economy.inputs.wageBillPerWeek).toBe(0);
  });

  it('uses a patrol area to keep a handyman on its connected paths', () => {
    const sim = new Simulation({ seed: 2, width: 16, height: 16 });
    const w = sim.world;
    w.map.fillFlat(2);
    for (let x = 4; x <= 10; x++) sim.enqueue({ type: 'placePath', x, y: 6, z: 2 });
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
    sim.step();
    const staffId = w.staff.slotToId[0];
    for (let x = 4; x <= 7; x++)
      sim.enqueue({ type: 'setStaffPatrolTile', staffId, x, y: 6, enabled: true });
    sim.step();
    w.staff.cols.x[0] = 4 * 256 + 128;
    w.staff.cols.y[0] = 6 * 256 + 128;
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
    for (let x = 4; x <= 10; x++) placePath(world.map, { x, y: 6, z: 2 });
    placePath(world.map, { x: 5, y: 8, z: 2 });
    placePath(world.map, { x: 5, y: 9, z: 2 });
    spawnStaff(world, StaffKind.Handyman);
    world.staff.cols.x[0] = 4 * 256 + 128;
    world.staff.cols.y[0] = 6 * 256 + 128;
    dropLitter(world, 5, 8, LitterKind.Trash);
    dropLitter(world, 8, 6, LitterKind.Trash);

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
    expect(world.map.elData[reachableBin]).toBe(0);
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

    staffSystem.update(world);

    expect(world.rides.cols.state[rideSlot]).toBe(RideState.Open);
    expect(world.rides.cols.phase[rideSlot]).toBe(RidePhase.Waiting);
    expect(world.rides.cols.reliability[rideSlot]).toBe(100);
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

    staffSystem.update(world);

    expect(world.rides.cols.state[unreachableSlot]).toBe(RideState.Broken);
    expect(world.rides.cols.state[reachableSlot]).toBe(RideState.Open);
    expect(world.rides.cols.reliability[reachableSlot]).toBe(100);
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
    spawnStaff(world, StaffKind.Handyman);
    spawnStaff(world, StaffKind.Entertainer);
    world.staff.cols.x[1] = 5 * 256 + 128;
    world.staff.cols.y[1] = 5 * 256 + 128;
    world.tick = 79;

    staffSystem.update(world);

    expect(world.guests.cols.happiness[guestSlot]).toBe(101);
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

    for (let tick = 0; tick < 300; tick++) sim.step();

    expect(world.rides.cols.state[rideSlot]).toBe(RideState.Open);
    expect(world.rides.cols.reliability[rideSlot]).toBe(100);
  });
});
