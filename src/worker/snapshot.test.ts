import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/core/simulation';
import { World } from '../sim/core/world';
import { TILE_UNITS } from '../sim/core/constants';
import { OWNED, RIGHTS_OWNED, SALE_RIGHTS } from '../sim/map/tile-map';
import { createCoaster, buildCircuit, flatOwnedSim } from '../sim/rides/coaster-fixtures';
import { FeedbackDomain } from '../sim/core/feedback';
import { RidePhase, RideState } from '../sim/rides/ride-store';
import { GuestState } from '../sim/guests/guest-store';
import { flatWorld, guestAt, layPath, openRide, row } from '../sim/integration/fixtures';
import { RideType } from '../sim/rides/ride-types';
import { createRide } from '../sim/rides/ride-operations';
import { MechanicStatus, breakRide } from '../sim/rides/ride-maintenance';
import { BreakdownReason } from '../sim/rides/breakdown-reasons';
import { LedgerCategory, PriceMode } from '../sim/economy/ledger';
import { applyScenario } from '../sim/scenario/scenario';
import { findScenario } from '../sim/scenario/catalog';
import { Funding } from '../sim/research/research';
import { prepareFlat } from '../sim/integration/fixtures';
import { PIECES } from '../sim/track/catalog';
import { INSPECTION_MINUTE_TICKS, RIDE_CATALOG } from '../sim/rides/ride-types';
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
  it('publishes the next enabled invention and its three progress stages', () => {
    const world = new World({ seed: 1, width: 16, height: 16 });
    applyScenario(world, {
      id: 'research-snapshot',
      name: 'Research snapshot',
      seed: 1,
      mapWidth: 16,
      mapHeight: 16,
      startingCash: 1_000_000,
      startingLoan: 0,
      maxLoan: 0,
      annualInterestBps: 0,
      averageGuestCashCents: 5_000,
      difficultRating: false,
      priceMode: 0,
      admissionPrice: 0,
      availableItemIds: [1],
      inventions: [{ itemId: 9, category: 2, workUnits: 180 }],
      objective: { kind: 0, target: 0, rating: 0, categoryMask: 0, byTick: 1 },
    });
    world.research.enabledCategoryMask = 1 << 2;
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(world, snapshot);
    expect(snapshot.research.currentItemId).toBe(9);
    expect(snapshot.research.progressStage).toBe('Initial research');

    world.research.currentIndex = 0;
    world.research.progress = 60;
    writeSnapshot(world, snapshot);
    expect(snapshot.research.progressStage).toBe('Designing');

    world.research.progress = 120;
    writeSnapshot(world, snapshot);
    expect(snapshot.research.progressStage).toBe('Completing design');
  });

  it('publishes successful build and demolition cues once', () => {
    const simulation = new Simulation({ seed: 5, width: 16, height: 16 });
    prepareFlat(simulation.world);
    simulation.world.economy.cash = 1_000_000;
    simulation.enqueue({ type: 'placePath', x: 4, y: 4 });
    simulation.step();
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });
    writeSnapshot(simulation.world, snapshot);
    expect(snapshot.audioEvents).toEqual([{ id: 1, type: 'build' }]);
    expect(simulation.world.audioEvents).toEqual([]);
    simulation.enqueue({ type: 'removePath', x: 4, y: 4 });
    simulation.step();
    writeSnapshot(simulation.world, snapshot);
    expect(snapshot.audioEvents).toEqual([{ id: 2, type: 'demolish' }]);
    writeSnapshot(simulation.world, snapshot);
    expect(snapshot.audioEvents).toEqual([]);
  });

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

  it('publishes each worker facing direction for sprite selection', () => {
    const world = flatWorld(8, 8);
    world.staff.spawn();
    const staff = world.staff.cols;
    const slot = 0;
    const tileX = Math.floor(staff.x[slot]! / TILE_UNITS);
    const tileY = Math.floor(staff.y[slot]! / TILE_UNITS);
    staff.targetX[slot] = tileX - 1;
    staff.targetY[slot] = tileY;
    const snapshot = createSnapshot({ guests: 0, staff: 1, vehicles: 0, litter: 0 });

    writeSnapshot(world, snapshot);

    expect((snapshot.staff.data[3]! >>> 8) & 3).toBe(2);
  });

  it('publishes guest direction and palette to the render snapshot', () => {
    const world = flatWorld(8, 8);
    guestAt(world, 3, 4);
    const slot = world.guests.count - 1;
    world.guests.cols.state[slot] = GuestState.Wandering;
    world.guests.cols.tint[slot] = 6;
    world.guests.cols.heading[slot] = 2;
    const snapshot = createSnapshot({ guests: 1, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(world, snapshot);

    expect(snapshot.guests.data[3] & 0xff).toBe(6);
    expect((snapshot.guests.data[3] >>> 16) & 0xff).toBe(2);
  });

  it('publishes the whole line for a ride, not just its head of queue', () => {
    const world = flatWorld(24, 8);
    layPath(world, row(5, 3, 15));
    const ride = openRide(world, RideType.MerryGoRound, [8, 4], [8, 5], [9, 4], [[7, 5]]);
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

  it('publishes each flat ride orientation and the level its floor sits at', () => {
    const world = flatWorld(24);
    createRide(world, RideType.SwingingShip, 8, 6, 3);
    const raised = world.map.vertexIndex(9, 6);
    world.map.vertexHeights[raised] = world.map.vertexHeights[raised] + 2;
    for (const [x, y] of [
      [8, 5],
      [9, 5],
      [8, 6],
      [9, 6],
    ])
      world.map.refreshTile(world.map.index(x, y));
    const snapshot = createSnapshot({ guests: 1, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(world, snapshot);

    expect(snapshot.rideInfo[RideInfo.Dir]).toBe(3);
    expect(snapshot.rideInfo[RideInfo.BaseLevel]).toBe(6);
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

  it('publishes the weekly wage bill to the finance summary', () => {
    const world = new World({ seed: 9, width: 8, height: 8 });
    world.economy.inputs.wageBillPerWeek = 1_154;
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

  it('publishes the retained months, newest first, and the recurring upkeep bill', () => {
    const world = new World({ seed: 9, width: 8, height: 8 });
    const l = world.economy;
    l.monthsCompleted = 3;
    l.historyHead = 2;
    l.history[0 * LedgerCategory.COUNT + LedgerCategory.Wages] = -100;
    l.history[1 * LedgerCategory.COUNT + LedgerCategory.Wages] = -200;
    l.history[2 * LedgerCategory.COUNT + LedgerCategory.Wages] = -300;
    l.inputs.rideUpkeepPerFortnight = 4_400;
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(world, snapshot);

    expect(snapshot.economy.pastMonths.map((m) => m[LedgerCategory.Wages])).toEqual([
      -300, -200, -100, 0, 0,
    ]);
    expect(snapshot.economy.rideUpkeepPerFortnight).toBe(4_400);
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
    world.track.pieces.cols.z[slot] = 3;
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
      96,
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

  it('publishes the elapsed share of the Running phase and zero in other phases', () => {
    const sim = flatOwnedSim();
    const rideId = createCoaster(sim, RideType.SteelLoopingCoaster);
    const slot = sim.world.rides.idToSlot[rideId];
    const rides = sim.world.rides.cols;
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });
    const progress = (): number => {
      writeSnapshot(sim.world, snapshot);
      return snapshot.rideInfo[RideInfo.PhaseProgress]!;
    };

    rides.runTicks[slot] = 480;
    rides.phase[slot] = RidePhase.Running;
    rides.phaseTicks[slot] = 480;
    expect(progress()).toBe(0);
    rides.phaseTicks[slot] = 240;
    expect(progress()).toBe(500);
    rides.phaseTicks[slot] = 1;
    expect(progress()).toBe(998);
    rides.phase[slot] = RidePhase.Unloading;
    expect(progress()).toBe(0);
  });

  it("publishes each ride's maintenance state", () => {
    const w = flatWorld();
    const rideId = createRide(w, RideType.Twist, 4, 4);
    const slot = w.rides.idToSlot[rideId];
    w.rides.cols.reliability[slot] = 63;
    w.rides.cols.inspectionIntervalTicks[slot] = 20 * INSPECTION_MINUTE_TICKS;
    w.rides.cols.lastInspectionTick[slot] = 0;
    w.tick = 7 * INSPECTION_MINUTE_TICKS + 5;
    w.rides.cols.state[slot] = RideState.Open;
    breakRide(w, slot, BreakdownReason.SafetyCutOut);
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(w, snapshot);

    const info = snapshot.rideInfo;
    expect(info[RideInfo.InspectionMinutes]).toBe(20);
    expect(info[RideInfo.MinutesSinceInspection]).toBe(7);
    expect(info[RideInfo.MechanicStatus]).toBe(MechanicStatus.Calling);
    expect(info[RideInfo.Downtime]).toBe(0);
    expect(info[RideInfo.Reliability]).toBe(63);
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
    const constructionCost = RIDE_CATALOG[RideType.SteelLoopingCoaster].cost + PIECES[0].cost;
    expect(info[o + RideInfo.DemolitionRefund]).toBe(constructionCost);
    const rideSlot = sim.world.rides.idToSlot[rideId];
    sim.world.rides.cols.guestsServed[rideSlot] = 1;
    writeSnapshot(sim.world, snapshot);
    expect(snapshot.rideInfo[o + RideInfo.DemolitionRefund]).toBe(
      Math.floor((constructionCost * 70) / 100),
    );
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
    world.guests.cols.voucherKind[guest] = 3;
    world.guests.cols.voucherTarget[guest] = 12;
    world.weather.kind = 3;
    const snapshot = createSnapshot({ guests: 4, staff: 0, vehicles: 0, litter: 0 });

    writeSnapshot(world, snapshot);

    expect(Array.from(snapshot.guestDetails.slice(0, 10))).toEqual([
      177, 88, 43, 29, 17, 222, 3456, 2, 6, 2,
    ]);
    expect(Array.from(snapshot.guestDetails.slice(17, 19))).toEqual([3, 12]);
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
    expect(snapshotBuffers(snapshot)).toHaveLength(16);
  });
});

describe('render snapshot research unlocks', () => {
  it('reports only the scenario starting rides as unlocked until research adds more', () => {
    const simulation = new Simulation({ seed: 1, width: 16, height: 16 });
    const starter = findScenario('starter')!;
    applyScenario(simulation.world, starter);
    const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });
    writeSnapshot(simulation.world, snapshot);
    const unlocked = (type: number) => snapshot.research.unlockedRides[type] === 1;
    for (const type of [
      RideType.MerryGoRound,
      RideType.SwingingShip,
      RideType.FerrisWheel,
      RideType.Twist,
      RideType.FoodStall,
      RideType.DrinkStall,
      RideType.InformationKiosk,
      RideType.Toilets,
      RideType.JuniorRollerCoaster,
    ]) {
      expect(unlocked(type), `ride type ${type}`).toBe(true);
    }
    expect(unlocked(RideType.SteelLoopingCoaster)).toBe(false);

    simulation.world.research.unlocked.add(RideType.SteelLoopingCoaster);
    writeSnapshot(simulation.world, snapshot);
    expect(unlocked(RideType.SteelLoopingCoaster)).toBe(true);
    expect(unlocked(RideType.FerrisWheel)).toBe(true);
  });
});
