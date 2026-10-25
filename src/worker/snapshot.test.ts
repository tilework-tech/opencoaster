import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/core/simulation';
import { World } from '../sim/core/world';
import { OWNED, RIGHTS_OWNED, SALE_RIGHTS } from '../sim/map/tile-map';
import { createCoaster, buildCircuit, flatOwnedSim } from '../sim/rides/coaster-fixtures';
import { FeedbackDomain } from '../sim/core/feedback';
import { RideState } from '../sim/rides/ride-store';
import { GuestState } from '../sim/guests/guest-store';
import { flatWorld, guestAt, layPath, openRide, row } from '../sim/integration/fixtures';
import { RideType } from '../sim/rides/ride-types';
import { LedgerCategory, PriceMode } from '../sim/economy/ledger';
import { Funding } from '../sim/research/research';
import { StaffKind, StaffOrder } from '../sim/staff/staff-store';
import {
  RideInfo,
  RIDE_INFO_STRIDE,
  createSnapshot,
  decodeCursor,
  snapshotBuffers,
  writeSnapshot,
} from './snapshot';

describe('render snapshot', () => {
  it('publishes each worker task-order mask by stable staff id', () => {
    const simulation = new Simulation({ seed: 19, width: 8, height: 8 });
    simulation.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
    simulation.step();
    const staffId = simulation.world.staff.slotToId[0];
    simulation.enqueue({
      type: 'setStaffOrder',
      staffId,
      order: 'sweep-paths',
      enabled: false,
    });
    simulation.step();
    const snapshot = createSnapshot({ guests: 0, staff: 1, vehicles: 0, litter: 0 });

    writeSnapshot(simulation.world, snapshot);

    expect(snapshot.staffIds[0]).toBe(staffId);
    expect(snapshot.staffOrders[0] & (1 << StaffOrder.SweepPaths)).toBe(0);
    expect(snapshot.staffOrders[0] & (1 << StaffOrder.EmptyBins)).not.toBe(0);
  });

  it('publishes the whole line for a ride, not just its head of queue', () => {
    const world = flatWorld(24, 8);
    layPath(world, row(5, 3, 15));
    const ride = openRide(world, RideType.MerryGoRound, [8, 4], [8, 5], [8, 3], [[7, 5]]);
    const id = world.rides.slotToId[ride];
    for (let i = 0; i < 5; i++) {
      guestAt(world, 5, 5);
      const slot = world.guests.count - 1;
      world.guests.cols.state[slot] = i < 2 ? GuestState.Waiting : GuestState.Queuing;
      world.guests.cols.targetRide[slot] = id;
    }
    world.rides.cols.queueLength[ride] = 2;
    const snapshot = createSnapshot({ guests: 8, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(world, snapshot);

    expect(snapshot.rideInfo[ride * RIDE_INFO_STRIDE + RideInfo.QueueLength]).toBe(5);
  });

  it('publishes finance values to the render snapshot', () => {
    const world = new World({ seed: 9, width: 8, height: 8 });
    world.economy.cash = 345678;
    world.economy.loan = 23000;
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(world, snapshot);

    expect(snapshot.park.cash).toBe(345678);
    expect(snapshot.park.loan).toBe(23000);
    expect(snapshot.park.rides).toBe(world.rides.count);
  });

  it('converts monthly staff wages to the weekly finance summary', () => {
    const world = new World({ seed: 9, width: 8, height: 8 });
    world.economy.inputs.wageBillPerMonth = 5_000;
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(world, snapshot);

    expect(snapshot.economy.wageBillPerWeek).toBe(1_154);
  });

  it('publishes the park gate tile to renderers', () => {
    const world = new World({ seed: 9, width: 8, height: 8 });
    world.park.entranceX = 3;
    world.park.entranceY = 5;
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(world, snapshot);

    expect(snapshot.park.entranceX).toBe(3);
    expect(snapshot.park.entranceY).toBe(5);
  });

  it('publishes pricing, monthly ledger totals and research state for the finance and research windows', () => {
    const world = new World({ seed: 9, width: 8, height: 8 });
    world.economy.priceMode = PriceMode.Admission;
    world.economy.admissionPrice = 450;
    world.economy.maxLoan = 5_000_000;
    world.economy.monthlyTotals[LedgerCategory.Admission] = 1200;
    world.economy.history[LedgerCategory.Wages] = -700;
    world.economy.monthsCompleted = 1;
    world.economy.historyHead = 0;
    world.research.funding = Funding.Normal;
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(world, snapshot);

    expect(snapshot.economy.priceMode).toBe(PriceMode.Admission);
    expect(snapshot.economy.admissionPrice).toBe(450);
    expect(snapshot.economy.maxLoan).toBe(5_000_000);
    expect(snapshot.economy.thisMonth[LedgerCategory.Admission]).toBe(1200);
    expect(snapshot.economy.lastMonth[LedgerCategory.Wages]).toBe(-700);
    expect(snapshot.research.funding).toBe(Funding.Normal);
  });

  it('publishes whether each tile allows construction', () => {
    const world = new World({ seed: 9, width: 8, height: 8 });
    const owned = world.map.index(2, 2);
    const rights = world.map.index(3, 2);
    const forSale = world.map.index(4, 2);
    world.map.ownership[owned] = OWNED;
    world.map.ownership[rights] = RIGHTS_OWNED | SALE_RIGHTS;
    world.map.ownership[forSale] = SALE_RIGHTS;
    const snapshot = createSnapshot({
      guests: 0,
      staff: 0,
      vehicles: 0,
      litter: 0,
      mapTiles: world.map.ownership.length,
    });

    writeSnapshot(world, snapshot);

    expect(snapshot.buildable[owned]).toBe(1);
    expect(snapshot.buildable[rights]).toBe(1);
    expect(snapshot.buildable[forSale]).toBe(0);
    expect(snapshotBuffers(snapshot)).toContain(snapshot.buildable.buffer);
  });

  it('publishes track piece position, type, and ride identity to renderers', () => {
    const world = new World({ seed: 11, width: 8, height: 8 });
    const firstRide = world.rides.spawn();
    const secondRide = world.rides.spawn();
    const slot = world.track.pieces.spawn();
    world.track.pieces.cols.x[slot] = 3;
    world.track.pieces.cols.y[slot] = 5;
    world.track.pieces.cols.z[slot] = 2;
    world.track.pieces.cols.pieceType[slot] = 42;
    world.track.pieces.cols.dir[slot] = 1;
    world.track.pieces.cols.rideId[slot] = world.rides.slotToId[secondRide];
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(world, snapshot);

    expect(snapshot.tracks.count).toBe(1);
    expect(snapshot.rides.data[firstRide * 4 + 3]).toBe(world.rides.slotToId[firstRide]);
    expect(snapshot.rides.data[secondRide * 4 + 3]).toBe(world.rides.slotToId[secondRide]);
    expect(Array.from(snapshot.tracks.data.slice(0, 4))).toEqual([
      896,
      1408,
      128,
      (world.rides.slotToId[secondRide] << 16) | 298,
    ]);
  });

  it('produces identical render snapshots for the same seed and command sequence', () => {
    const capture = () => {
      const sim = new Simulation({ seed: 21, width: 8, height: 8, maxGuests: 32 });
      sim.enqueue({ type: 'spawnGuests', count: 12 });
      for (let i = 0; i < 20; i++) sim.step();
      const snapshot = createSnapshot({ guests: 32, staff: 0, vehicles: 0, litter: 0 });
      writeSnapshot(sim.world, snapshot);
      return {
        tick: snapshot.tick,
        guests: snapshot.guests.data.slice(0, snapshot.guests.count * 4),
        staff: snapshot.staff.data.slice(0, snapshot.staff.count * 4),
        vehicles: snapshot.vehicles.data.slice(0, snapshot.vehicles.count * 4),
        litter: snapshot.litter.data.slice(0, snapshot.litter.count * 4),
        rides: snapshot.rides.data.slice(0, snapshot.rides.count * 4),
        tracks: snapshot.tracks.data.slice(0, snapshot.tracks.count * 4),
        park: snapshot.park,
      };
    };

    expect(capture()).toEqual(capture());
  });

  it('publishes per-ride status, ratings and the track construction cursor', () => {
    const sim = flatOwnedSim();
    const rideId = createCoaster(sim, RideType.SteelLoopingCoaster);
    buildCircuit(sim, rideId, [['station', 0]]);
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(sim.world, snapshot);

    const o = 0 * RIDE_INFO_STRIDE;
    const info = snapshot.rideInfo;
    expect(info[o + RideInfo.Id]).toBe(rideId);
    expect(info[o + RideInfo.Type]).toBe(RideType.SteelLoopingCoaster);
    expect(info[o + RideInfo.State]).toBe(RideState.Closed);
    expect(info[o + RideInfo.TrackPieces]).toBe(1);
    expect(decodeCursor(info[o + RideInfo.Cursor])).toEqual({
      hasTrack: true,
      dir: 0,
      slope: 0,
      bank: 0,
    });
    expect([info[o + RideInfo.CursorX], info[o + RideInfo.CursorY]]).toEqual([21, 20]);
  });

  it('publishes the guest needs and thought history for click-to-inspect windows', () => {
    const world = new World({ seed: 12, width: 8, height: 8 });
    const guest = world.guests.spawn();
    world.guests.cols.happiness[guest] = 177;
    world.guests.cols.hunger[guest] = 88;
    world.guests.cols.thirst[guest] = 43;
    world.guests.cols.toilet[guest] = 29;
    world.guests.cols.nausea[guest] = 17;
    world.guests.cols.energy[guest] = 222;
    world.guests.cols.cash[guest] = 3456;
    world.guests.cols.thought0[guest] = 6;
    world.guests.cols.thought1[guest] = 2;
    world.guests.cols.thoughtCursor[guest] = 2;
    world.weather.kind = 3;
    const snapshot = createSnapshot({ guests: 4, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(world, snapshot);

    expect(Array.from(snapshot.guestDetails.slice(0, 10))).toEqual([
      177, 88, 43, 29, 17, 222, 3456, 2, 6, 2,
    ]);
    expect(snapshot.weather.kind).toBe(3);
    expect(snapshotBuffers(snapshot)).toContain(snapshot.guestDetails.buffer);
  });

  it('publishes current reliability and cumulative income for each ride', () => {
    const world = new World({ seed: 9, width: 8, height: 8 });
    const slot = world.rides.spawn();
    world.rides.cols.reliability[slot] = 73;
    world.rides.cols.incomeCents[slot] = 12345;
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(world, snapshot);

    expect(snapshot.rideInfo[RideInfo.Reliability]).toBe(73);
    expect(snapshot.rideInfo[RideInfo.IncomeCents]).toBe(12345);
  });

  it('publishes the latest command feedback', () => {
    const sim = flatOwnedSim();
    sim.enqueue({ type: 'setRideStatus', rideId: 99, status: 'open' });
    sim.step();
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(sim.world, snapshot);

    expect(snapshot.feedback.domain).toBe(FeedbackDomain.Ride);
    expect(snapshot.feedback.seq).toBe(sim.world.feedback.seq);
    expect(snapshot.feedback.code).toBe(sim.world.feedback.code);
  });
});

describe('staff and ground state in the snapshot', () => {
  it('publishes staff ids, names and per-tile grounds', () => {
    const sim = new Simulation({ seed: 4, width: 8, height: 8 });
    sim.world.map.terrain.fill(0);
    sim.world.map.fillFlat(2);
    sim.enqueue({ type: 'hireStaff', kind: 0 });
    sim.enqueue({ type: 'hireStaff', kind: 2 });
    sim.step();
    const [first, second] = [sim.world.staff.slotToId[0], sim.world.staff.slotToId[1]];
    sim.enqueue({ type: 'renameStaff', staffId: second, name: 'Rex' });
    sim.enqueue({ type: 'setFlowerBed', x: 2, y: 2, enabled: true });
    sim.step();
    const snapshot = createSnapshot({ guests: 0, staff: 4, vehicles: 0, litter: 0, mapTiles: 64 });

    writeSnapshot(sim.world, snapshot);

    expect(Array.from(snapshot.staffIds.subarray(0, 2))).toEqual([first, second]);
    expect(snapshot.staffNames.get(second)).toBe('Rex');
    expect(snapshot.staffNames.has(first)).toBe(false);
    expect(snapshot.grounds[sim.world.map.index(2, 2)]).toBe(
      sim.world.grounds[sim.world.map.index(2, 2)],
    );
    expect(snapshotBuffers(snapshot)).toHaveLength(14);
  });
});
