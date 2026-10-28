import { applyScenario } from '../sim/scenario/scenario';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/core/simulation';
import { hashWorld } from '../sim/core/hash';
import { PieceId } from '../sim/track/catalog';
import { SAVE_VERSION, deserialize, serialize } from './save';
import { allWorldViews, withoutColumns } from './legacy-save-fixtures';
import { RIDER_HISTORY_WINDOWS, RIDE_COLUMNS_ADDED_IN_V10 } from '../sim/rides/ride-store';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { RidePhase, RideState } from '../sim/rides/ride-store';
import { RideResult } from '../sim/rides/ride-results';
import {
  BreakdownReason,
  breakRide,
  getRideDowntimePercent,
  updateRideMaintenance,
} from '../sim/rides';
import { legacyGuestArrays } from '../sim/integration/fixtures';
import { GuestState, HEADING_NONE } from '../sim/guests/guest-store';
import { LEAVING_COUNTDOWN } from '../sim/guests/navigation';
import { VoucherKind } from '../sim/economy/vouchers';
import type { World } from '../sim/core/world';
import { flatWorld, guestAt, layPath, row } from '../sim/integration/fixtures';
import {
  StaffKind,
  StaffOrder,
  setStaffPatrolTile,
  staffPatrolTileEnabled,
  staffOrderEnabled,
  spawnStaff,
} from '../sim/staff/staff-store';
import { dropLitter, LitterKind } from '../sim/guests/litter-store';
import { Climate, DEFAULT_CLIMATE, WeatherKind } from '../sim/weather/weather';
import { PATH_BOARDING_MARKS, PathStyle, OWNED } from '../sim/map/tile-map';
import { placeScenery, SceneryItem } from '../sim/map/scenery';
import { refreshQueueIndex } from '../sim/rides/queue-lines';
import { createRide, placeRideEntranceExit } from '../sim/rides/ride-operations';
import {
  SMALL_CIRCUIT,
  buildCircuit,
  createCoaster,
  flatOwnedSim,
  queueGuests,
  run,
} from '../sim/rides/coaster-fixtures';
import { syncVehicleTracks, VehicleTrackRegistry } from '../sim/vehicles/vehicle-track';
import { rideTrainSlots } from '../sim/vehicles/ride-trains';

describe('save', () => {
  it('repairs a serialized station-last test train so it completes testing and serves guests', () => {
    const sim = flatOwnedSim(1);
    const rideId = createCoaster(sim, RideType.WoodenCoaster);
    buildCircuit(sim, rideId, [...SMALL_CIRCUIT.slice(1), ...SMALL_CIRCUIT.slice(0, 1)]);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    sim.step();
    const tracks = new VehicleTrackRegistry();
    syncVehicleTracks(sim.world, tracks);
    const track = tracks.get(rideId)!;
    const train = rideTrainSlots(sim.world, rideId)[0];
    sim.world.vehicles.cols.trackPos[train] = track.cumulativeLengthsQ8[track.stationSegment - 1];
    sim.world.vehicles.cols.lastSegment[train] = track.stationSegment - 1;

    const loaded = new Simulation(deserialize(serialize(sim.world)));
    const loadedTrain = rideTrainSlots(loaded.world, rideId)[0];
    expect(loaded.world.vehicles.cols.trackPos[loadedTrain]).toBe(
      track.cumulativeLengthsQ8[track.stationSegment],
    );
    run(loaded, 9000);
    const rideSlot = loaded.world.rides.idToSlot[rideId];
    expect(loaded.world.rides.cols.tested[rideSlot]).toBe(1);

    const stationType = PieceId.Station;
    const station = loaded.world.track.pieces.cols;
    let stationX = -1;
    let stationY = -1;
    for (let piece = 0; piece < loaded.world.track.pieces.count; piece++) {
      if (station.rideId[piece] === rideId && station.pieceType[piece] === stationType) {
        stationX = station.x[piece];
        stationY = station.y[piece];
      }
    }
    loaded.enqueue({ type: 'placePath', x: stationX, y: stationY - 2 });
    loaded.enqueue({ type: 'placeRideEntrance', rideId, x: stationX, y: stationY - 1 });
    loaded.enqueue({ type: 'placeRideExit', rideId, x: stationX, y: stationY + 1 });
    loaded.step();
    queueGuests(loaded, rideId, 12);
    loaded.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    run(loaded, 3000);
    expect(loaded.world.rides.cols.tested[rideSlot]).toBe(1);
    expect(loaded.world.rides.cols.guestsServed[rideSlot]).toBeGreaterThan(0);
  });

  it('writes the current version with climate metadata', () => {
    expect(SAVE_VERSION).toBe(33);
    const sim = new Simulation({ seed: 1, width: 8, height: 8 });
    sim.world.weather.climate = Climate.Cold;
    expect(spawnStaff(sim.world, StaffKind.Security)).toBe(true);
    sim.world.staff.cols.vandalsStopped[0] = 27;
    const bytes = serialize(sim.world);
    const headerLength = new DataView(bytes.buffer).getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength)));
    expect(header.version).toBe(33);
    expect(header.weather.climate).toBe(Climate.Cold);
    const restored = deserialize(bytes);
    expect(restored.weather.climate).toBe(Climate.Cold);
    expect(restored.staff.cols.vandalsStopped[0]).toBe(27);
  });

  it('preserves the scenario guest cash average and defaults older saves', () => {
    const sim = new Simulation({ seed: 1, width: 8, height: 8 });
    sim.world.scenario.averageGuestCashCents = 7_500;
    expect(deserialize(serialize(sim.world)).scenario.averageGuestCashCents).toBe(7_500);

    const older = serialize(sim.world);
    const view = new DataView(older.buffer, older.byteOffset, older.byteLength);
    const headerEnd = 8 + view.getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(older.subarray(8, headerEnd)));
    header.version = 30;
    delete header.scenario.averageGuestCashCents;
    const json = new TextEncoder().encode(JSON.stringify(header));
    const body = older.subarray(headerEnd);
    const legacy = new Uint8Array(8 + json.length + body.length);
    new DataView(legacy.buffer).setUint32(0, view.getUint32(0, true), true);
    new DataView(legacy.buffer).setUint32(4, json.length, true);
    legacy.set(json, 8);
    legacy.set(body, 8 + json.length);
    expect(deserialize(legacy).scenario.averageGuestCashCents).toBe(5_000);
  });

  it('loads version 26 saves and applies the version 27 migration', () => {
    const sim = new Simulation({ seed: 26, width: 8, height: 8 });
    const current = serialize(sim.world);
    const headerLength = new DataView(current.buffer).getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(current.subarray(8, 8 + headerLength)));
    header.version = 26;
    const encoded = new TextEncoder().encode(JSON.stringify(header));
    const version26 = new Uint8Array(8 + encoded.length + current.length - 8 - headerLength);
    version26.set(current.subarray(0, 8));
    new DataView(version26.buffer).setUint32(4, encoded.length, true);
    version26.set(encoded, 8);
    version26.set(current.subarray(8 + headerLength), 8 + encoded.length);

    const restored = deserialize(version26);
    expect(restored.tick).toBe(sim.world.tick);
  });

  it('migrates legacy walls to the edge that preserves their previous default appearance', () => {
    const sim = new Simulation({ seed: 22, width: 8, height: 8 });
    sim.world.map.ownership[sim.world.map.index(4, 4)] = OWNED;
    expect(placeScenery(sim.world.map, 4, 4, SceneryItem.WoodenFence, 3)).toBe(true);
    const current = serialize(sim.world);
    const headerLength = new DataView(current.buffer).getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(current.subarray(8, 8 + headerLength)));
    header.version = 23;
    const encoded = new TextEncoder().encode(JSON.stringify(header));
    const legacy = new Uint8Array(8 + encoded.length + current.length - 8 - headerLength);
    legacy.set(current.subarray(0, 8));
    new DataView(legacy.buffer).setUint32(4, encoded.length, true);
    legacy.set(encoded, 8);
    legacy.set(current.subarray(8 + headerLength), 8 + encoded.length);

    const loaded = deserialize(legacy);
    const tile = loaded.map.index(4, 4);
    expect(loaded.map.elFlags[loaded.map.firstElement(tile)]).toBe(0);
  });

  it('migrates version 14 world state while preserving its ride-history windows', () => {
    const sim = new Simulation({ seed: 17, width: 8, height: 8 });
    sim.enqueue({ type: 'spawnGuests', count: 1 });
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
    sim.step();
    const guest = 0;
    sim.world.guests.cols.litterMemory[guest] = 9;
    sim.world.guests.cols.angriness[guest] = 12;
    sim.world.staff.cols.sweeps[0] = 23;
    sim.world.staff.cols.vandalsStopped[0] = 5;
    sim.world.weather.climate = Climate.Cold;
    sim.world.litter.spawn();
    sim.world.litter.spawn();
    sim.world.litter.cols.age[0] = 20;
    sim.world.litter.cols.age[1] = 10;
    sim.world.litter.cols.birthOrder[0] = 31;
    sim.world.litter.cols.birthOrder[1] = 32;
    sim.world.guests.cols.rideHistory0[guest] = 41;
    const ride = sim.world.rides.spawn();
    (sim.world.rides.cols as unknown as Record<string, Uint16Array>).ridersWindow00[ride] = 42;
    const views = allWorldViews(sim.world);
    const legacy = withoutColumns(serialize(sim.world), 14, views, [
      sim.world.guests.cols.litterMemory,
      sim.world.guests.cols.angriness,
      sim.world.staff.cols.sweeps,
      sim.world.staff.cols.vandalsStopped,
      sim.world.litter.cols.birthOrder,
    ]);

    const loaded = deserialize(legacy);

    expect(loaded.guests.cols.litterMemory[guest]).toBe(0);
    expect(loaded.guests.cols.angriness[guest]).toBe(0);
    expect(loaded.staff.cols.sweeps[0]).toBe(0);
    expect(loaded.staff.cols.vandalsStopped[0]).toBe(0);
    expect(loaded.litter.cols.birthOrder[0]).toBeLessThan(loaded.litter.cols.birthOrder[1]);
    expect(loaded.guests.cols.rideHistory0[guest]).toBe(41);
    expect((loaded.rides.cols as unknown as Record<string, Uint16Array>).ridersWindow00[ride]).toBe(
      42,
    );
    expect(loaded.weather.climate).toBe(DEFAULT_CLIMATE);
  });

  it('migrates version 15 staff statistics while preserving existing worker data', () => {
    const sim = new Simulation({ seed: 18, width: 8, height: 8 });
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Security });
    sim.step();
    sim.world.staff.cols.sweeps[0] = 23;
    const legacy = withoutColumns(serialize(sim.world), 15, allWorldViews(sim.world), []);

    const loaded = deserialize(legacy);

    expect(loaded.staff.cols.sweeps[0]).toBe(23);
    expect(loaded.staff.cols.vandalsStopped[0]).toBe(0);
  });

  it('round-trips staff statistics and guest sight memory', () => {
    const sim = new Simulation({ seed: 19, width: 8, height: 8 });
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
    sim.step();
    const cols = sim.world.staff.cols;
    cols.lawnsMown[0] = 11;
    cols.gardensWatered[0] = 12;
    cols.binsEmptied[0] = 13;
    cols.ridesInspected[0] = 14;
    cols.ridesFixed[0] = 15;
    cols.guestsEntertained[0] = 16;
    cols.hiredTick[0] = 1234;
    cols.mowTimeout[0] = 5;

    const loaded = deserialize(serialize(sim.world)).staff.cols;

    expect([
      loaded.lawnsMown[0],
      loaded.gardensWatered[0],
      loaded.binsEmptied[0],
      loaded.ridesInspected[0],
      loaded.ridesFixed[0],
      loaded.guestsEntertained[0],
      loaded.hiredTick[0],
      loaded.mowTimeout[0],
    ]).toEqual([11, 12, 13, 14, 15, 16, 1234, 5]);
  });

  it('loads a version 31 save with zeroed statistics and mowing kept on for gardeners', () => {
    const sim = new Simulation({ seed: 20, width: 8, height: 8 });
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
    sim.step();
    sim.world.staff.cols.sweeps[0] = 9;
    sim.world.staff.cols.orderFlags[0] &= ~(1 << StaffOrder.MowGrass);
    sim.world.staff.cols.orderFlags[1] &= ~(
      (1 << StaffOrder.MowGrass) |
      (1 << StaffOrder.WaterGardens)
    );
    const w = sim.world;
    const legacy = withoutColumns(serialize(w), 31, allWorldViews(w), []);

    const loaded = deserialize(legacy).staff.cols;

    expect(loaded.sweeps[0]).toBe(9);
    expect(loaded.lawnsMown[0]).toBe(0);
    expect(loaded.orderFlags[0] & (1 << StaffOrder.MowGrass)).not.toBe(0);
    expect(loaded.orderFlags[1] & (1 << StaffOrder.MowGrass)).toBe(0);
  });

  it('round-trips the selected path style and defaults older saves to tarmac', () => {
    const world = flatWorld(16);
    layPath(world, row(5, 5, 7));
    const tile = world.map.index(5, 5);
    const element = world.map.pathElement(tile, -1);
    world.map.pathStyle[element] = PathStyle.CrazyPaving;

    const loaded = deserialize(serialize(world));
    const loadedElement = loaded.map.pathElement(tile, -1);

    expect(loaded.map.pathStyle[loadedElement]).toBe(PathStyle.CrazyPaving);

    const views = [
      ...world.map.arrays(),
      ...world.guests.arrays(),
      ...world.staff.arrays(),
      ...world.vehicles.arrays(),
      ...world.litter.arrays(),
      ...world.rides.arrays(),
      ...world.track.pieces.arrays(),
      ...world.track.rideTables(),
    ];
    const legacy = withoutColumns(serialize(world), 14, views, [world.map.pathStyle]);
    const migrated = deserialize(legacy);
    const migratedElement = migrated.map.pathElement(tile, -1);
    expect(migrated.map.pathStyle[migratedElement]).toBe(PathStyle.Tarmac);
  });

  it('round-trips individual worker task orders', () => {
    const sim = new Simulation({ seed: 14, width: 8, height: 8 });
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Mechanic });
    sim.step();
    const staffId = sim.world.staff.slotToId[0];
    sim.enqueue({ type: 'setStaffOrder', staffId, order: 'inspect-rides', enabled: false });
    sim.step();

    const loaded = deserialize(serialize(sim.world));

    expect(staffOrderEnabled(loaded, staffId, StaffOrder.InspectRides)).toBe(false);
    expect(staffOrderEnabled(loaded, staffId, StaffOrder.RepairRides)).toBe(true);
  });

  it('migrates version 11 saves with workers using their role defaults', () => {
    const sim = new Simulation({ seed: 15, width: 8, height: 8 });
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Entertainer });
    sim.step();
    const staffId = sim.world.staff.slotToId[0];
    const current = serialize(sim.world);
    const views = [
      ...sim.world.map.arrays(),
      ...sim.world.guests.arrays(),
      ...sim.world.staff.arrays(),
      ...sim.world.vehicles.arrays(),
      ...sim.world.litter.arrays(),
      ...sim.world.rides.arrays(),
      ...sim.world.track.pieces.arrays(),
      ...sim.world.track.rideTables(),
    ];
    const legacy = withoutColumns(current, 11, views, [
      sim.world.guests.cols.visitTicks,
      sim.world.guests.cols.ridesTaken,
      sim.world.guests.cols.lastRide,
      sim.world.guests.cols.rideHistoryCursor,
      sim.world.guests.cols.rideHistory0,
      sim.world.guests.cols.rideHistory1,
      sim.world.guests.cols.rideHistory2,
      sim.world.guests.cols.rideHistory3,
      sim.world.staff.cols.orderFlags,
      ...riderHistoryColumns(sim.world),
    ]);

    const loaded = deserialize(legacy);

    expect(staffOrderEnabled(loaded, staffId, StaffOrder.EntertainGuests)).toBe(true);
    expect(staffOrderEnabled(loaded, staffId, StaffOrder.InspectRides)).toBe(false);
  });

  it('migrates version 12 guest stats and initializes guest history and staff orders', () => {
    const sim = new Simulation({ seed: 16, width: 8, height: 8 });
    sim.enqueue({ type: 'spawnGuests', count: 1 });
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Entertainer });
    sim.step();
    const guestId = sim.world.guests.slotToId[0];
    const guestSlot = sim.world.guests.idToSlot[guestId];
    const staffId = sim.world.staff.slotToId[0];
    sim.world.guests.cols.visitTicks[guestSlot] = 2345;
    sim.world.guests.cols.ridesTaken[guestSlot] = 7;
    sim.world.guests.cols.lastRide[guestSlot] = 42;
    const views = [
      ...sim.world.map.arrays(),
      ...sim.world.guests.arrays(),
      ...sim.world.staff.arrays(),
      ...sim.world.vehicles.arrays(),
      ...sim.world.litter.arrays(),
      ...sim.world.rides.arrays(),
      ...sim.world.track.pieces.arrays(),
      ...sim.world.track.rideTables(),
    ];
    const legacy = withoutColumns(serialize(sim.world), 12, views, [
      sim.world.guests.cols.rideHistoryCursor,
      sim.world.guests.cols.rideHistory0,
      sim.world.guests.cols.rideHistory1,
      sim.world.guests.cols.rideHistory2,
      sim.world.guests.cols.rideHistory3,
      sim.world.staff.cols.orderFlags,
      ...riderHistoryColumns(sim.world),
    ]);

    const loaded = deserialize(legacy);
    const loadedGuest = loaded.guests.idToSlot[guestId];

    expect(loaded.guests.cols.visitTicks[loadedGuest]).toBe(2345);
    expect(loaded.guests.cols.ridesTaken[loadedGuest]).toBe(7);
    expect(loaded.guests.cols.lastRide[loadedGuest]).toBe(42);
    expect(loaded.guests.cols.rideHistoryCursor[loadedGuest]).toBe(0);
    expect(loaded.guests.cols.rideHistory0[loadedGuest]).toBe(0);
    expect(loaded.staff.cols.orderFlags[0]).toBe(sim.world.staff.cols.orderFlags[0]);
    expect(staffOrderEnabled(loaded, staffId, StaffOrder.EntertainGuests)).toBe(true);
    expect(staffOrderEnabled(loaded, staffId, StaffOrder.InspectRides)).toBe(false);
  });

  it('migrates version 13 saves with worker and guest history but no ride rider windows', () => {
    const world = flatWorld(16);
    layPath(world, row(5, 6, 8));
    const guestSlot = guestAt(world, 5, 5);
    spawnStaff(world, StaffKind.Entertainer);
    const staffId = world.staff.slotToId[0];
    const staffSlot = world.staff.idToSlot[staffId];
    world.guests.cols.rideHistoryCursor[guestSlot] = 2;
    world.guests.cols.rideHistory0[guestSlot] = 17;
    world.staff.cols.orderFlags[staffSlot] &= ~(1 << StaffOrder.EntertainGuests);
    const rideSlot = world.rides.spawn();
    (world.rides.cols as unknown as Record<string, Uint16Array>).ridersWindow00[rideSlot] = 25;
    const views = [
      ...world.map.arrays(),
      ...world.guests.arrays(),
      ...world.staff.arrays(),
      ...world.vehicles.arrays(),
      ...world.litter.arrays(),
      ...world.rides.arrays(),
      ...world.track.pieces.arrays(),
      ...world.track.rideTables(),
    ];
    const legacy = withoutColumns(serialize(world), 13, views, [
      world.map.pathStyle,
      ...riderHistoryColumns(world),
    ]);

    const loaded = deserialize(legacy);

    expect(loaded.guests.cols.rideHistoryCursor[guestSlot]).toBe(2);
    expect(loaded.guests.cols.rideHistory0[guestSlot]).toBe(17);
    expect(loaded.staff.cols.orderFlags[staffSlot]).toBe(world.staff.cols.orderFlags[staffSlot]);
    expect(loaded.map.pathStyle[loaded.map.pathElement(world.map.index(6, 5), -1)]).toBe(
      PathStyle.Tarmac,
    );
    expect(staffOrderEnabled(loaded, staffId, StaffOrder.EntertainGuests)).toBe(false);
    expect(
      (loaded.rides.cols as unknown as Record<string, Uint16Array>).ridersWindow00[rideSlot],
    ).toBe(0);
  });

  it('round-trips world state exactly', () => {
    const sim = new Simulation({ seed: 11, width: 32, height: 32, maxGuests: 500 });
    sim.enqueue({ type: 'spawnGuests', count: 200 });
    for (let i = 0; i < 60; i++) sim.step();
    sim.world.patrolAreas[12] = 1;
    sim.world.umbrellas[sim.world.guests.slotToId[0]] = 1;
    sim.world.weather.ticksUntilChange = 1234;
    const loaded = deserialize(serialize(sim.world));
    expect(hashWorld(loaded)).toBe(hashWorld(sim.world));
    expect(loaded.patrolAreas[12]).toBe(1);
    expect(loaded.umbrellas[sim.world.guests.slotToId[0]]).toBe(1);
    expect(loaded.weather.ticksUntilChange).toBe(1234);
  });

  it('round-trips independent patrol areas for workers of the same role', () => {
    const sim = new Simulation({ seed: 44, width: 32, height: 16 });
    expect(spawnStaff(sim.world, StaffKind.Handyman)).toBe(true);
    expect(spawnStaff(sim.world, StaffKind.Handyman)).toBe(true);
    const firstId = sim.world.staff.slotToId[0];
    const secondId = sim.world.staff.slotToId[1];
    expect(setStaffPatrolTile(sim.world, firstId, 2, 8, true)).toBe(true);
    expect(setStaffPatrolTile(sim.world, secondId, 5, 8, true)).toBe(true);

    const restored = deserialize(serialize(sim.world));

    expect(hashWorld(restored)).toBe(hashWorld(sim.world));
    expect(restored.staff.cols.patrolArea[0]).not.toBe(restored.staff.cols.patrolArea[1]);
    expect(restored.staff.cols.patrolArea[0]).toBeGreaterThan(0);
    expect(restored.staff.cols.patrolArea[1]).toBeGreaterThan(0);
    expect(staffPatrolTileEnabled(restored, firstId, 2, 8)).toBe(true);
    expect(staffPatrolTileEnabled(restored, firstId, 5, 8)).toBe(false);
    expect(staffPatrolTileEnabled(restored, secondId, 5, 8)).toBe(true);
    expect(staffPatrolTileEnabled(restored, secondId, 2, 8)).toBe(false);
  });

  it('copies a version 19 role patrol area to each worker during migration', () => {
    const sim = new Simulation({ seed: 45, width: 32, height: 16 });
    expect(spawnStaff(sim.world, StaffKind.Handyman)).toBe(true);
    expect(spawnStaff(sim.world, StaffKind.Handyman)).toBe(true);
    const firstId = sim.world.staff.slotToId[0];
    const secondId = sim.world.staff.slotToId[1];
    const mapSize = sim.world.map.width * sim.world.map.height;
    const oldRoleMask = new Uint8Array(mapSize * 4);
    oldRoleMask[sim.world.map.index(2, 8)] = 1;
    const current = withoutColumns(serialize(sim.world), 20, allWorldViews(sim.world), []);
    const dataView = new DataView(current.buffer, current.byteOffset, current.byteLength);
    const headerEnd = 8 + dataView.getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(current.subarray(8, headerEnd)));
    header.version = 19;
    header.patrolAreas = Array.from(oldRoleMask);
    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const legacy = new Uint8Array(8 + headerBytes.length + current.length - headerEnd);
    new DataView(legacy.buffer).setUint32(0, dataView.getUint32(0, true), true);
    new DataView(legacy.buffer).setUint32(4, headerBytes.length, true);
    legacy.set(headerBytes, 8);
    legacy.set(current.subarray(headerEnd), 8 + headerBytes.length);

    const restored = deserialize(legacy);

    expect(restored.staff.cols.patrolArea[0]).not.toBe(restored.staff.cols.patrolArea[1]);
    expect(staffPatrolTileEnabled(restored, firstId, 2, 8)).toBe(true);
    expect(staffPatrolTileEnabled(restored, secondId, 2, 8)).toBe(true);
    expect(setStaffPatrolTile(restored, firstId, 2, 8, false)).toBe(true);
    expect(staffPatrolTileEnabled(restored, secondId, 2, 8)).toBe(true);
    expect(setStaffPatrolTile(restored, firstId, 5, 8, true)).toBe(true);
    expect(restored.staff.cols.patrolArea[0]).not.toBe(restored.staff.cols.patrolArea[1]);
  });

  it('a loaded world continues identically to the original', () => {
    const a = new Simulation({ seed: 11, width: 32, height: 32, maxGuests: 500 });
    a.enqueue({ type: 'spawnGuests', count: 100 });
    for (let i = 0; i < 30; i++) a.step();
    const b = new Simulation({ seed: 0, width: 1, height: 1 });
    Object.assign(b, { world: deserialize(serialize(a.world)) });
    for (let i = 0; i < 30; i++) {
      a.step();
      b.step();
    }
    expect(hashWorld(b.world)).toBe(hashWorld(a.world));
  });

  it('continues deterministically across a weather transition with staff and litter', () => {
    const original = new Simulation({ seed: 19, width: 16, height: 16 });
    original.world.map.fillFlat(2);
    original.enqueue({ type: 'placePath', x: 6, y: 6, z: 2 });
    original.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
    original.step();
    dropLitter(original.world, 6, 6, LitterKind.Trash);
    original.world.weather.kind = WeatherKind.Rain;
    original.world.weather.ticksUntilChange = 2;
    const continued = new Simulation({ seed: 1, width: 1, height: 1 });
    Object.assign(continued, { world: deserialize(serialize(original.world)) });
    expect(hashWorld(continued.world)).toBe(hashWorld(original.world));
    expect(continued.world.litter.count).toBe(1);
    expect(continued.world.staff.count).toBe(1);

    for (let i = 0; i < 20; i++) {
      original.step();
      continued.step();
    }

    expect(hashWorld(continued.world)).toBe(hashWorld(original.world));
    expect(original.world.weather.kind).not.toBe(WeatherKind.Rain);
  });

  it('rejects garbage input', () => {
    expect(() => deserialize(new Uint8Array(32))).toThrow();
  });
});

describe('save: legacy flat water rides', () => {
  it.each([RideType.LogFlume, RideType.RiverRapids])(
    'loads version 18 %s closed and ready for track reconstruction',
    (type) => {
      const world = flatWorld(16);
      const slot = world.rides.spawn();
      const rideId = world.rides.slotToId[slot];
      world.rides.cols.typeId[slot] = type;
      world.rides.cols.state[slot] = RideState.Open;
      world.rides.cols.phase[slot] = RidePhase.Running;
      world.rides.cols.rideX[slot] = 12;
      world.rides.cols.rideY[slot] = 14;
      world.rides.cols.entrancePlaced[slot] = 1;
      world.rides.cols.exitPlaced[slot] = 1;
      world.rides.cols.queueConnected[slot] = 1;
      world.rides.cols.queueLength[slot] = 5;
      world.rides.cols.boarded[slot] = 3;
      world.rides.cols.tested[slot] = 1;
      world.rides.cols.excitement[slot] = 620;
      const legacy = withoutColumns(serialize(world), 18, allWorldViews(world), []);

      const loaded = deserialize(legacy);
      const ride = loaded.rides.idToSlot[rideId];

      expect(loaded.rides.slotToId[ride]).toBe(rideId);
      expect(loaded.rides.cols.typeId[ride]).toBe(type);
      expect(loaded.rides.cols.state[ride]).toBe(RideState.Closed);
      expect(loaded.rides.cols.phase[ride]).toBe(RidePhase.Closed);
      expect(loaded.rides.cols.entrancePlaced[ride]).toBe(0);
      expect(loaded.rides.cols.exitPlaced[ride]).toBe(0);
      expect(loaded.rides.cols.queueConnected[ride]).toBe(0);
      expect(loaded.rides.cols.queueLength[ride]).toBe(0);
      expect(loaded.rides.cols.boarded[ride]).toBe(0);
      expect(loaded.rides.cols.tested[ride]).toBe(0);
      expect(loaded.rides.cols.excitement[ride]).toBe(0);
      expect(loaded.economy.cash).toBe(world.economy.cash);
    },
  );
});

describe('save: campaign vouchers', () => {
  it('round trips the voucher each guest carries', () => {
    const world = flatWorld(16);
    const guest = guestAt(world, 4, 5);
    world.guests.cols.voucherKind[guest] = VoucherKind.FreeFoodOrDrink;
    world.guests.cols.voucherTarget[guest] = 9;

    const loaded = deserialize(serialize(world));

    expect(loaded.guests.cols.voucherKind[guest]).toBe(VoucherKind.FreeFoodOrDrink);
    expect(loaded.guests.cols.voucherTarget[guest]).toBe(9);
  });

  it('loads version 17 guests as carrying no voucher', () => {
    const world = flatWorld(16);
    const guest = guestAt(world, 4, 5);
    const views = [
      ...world.map.arrays(),
      ...world.guests.arrays(),
      ...world.staff.arrays(),
      ...world.vehicles.arrays(),
      ...world.litter.arrays(),
      ...world.rides.arrays(),
      ...world.track.pieces.arrays(),
      ...world.track.rideTables(),
    ];
    const oldSave = withoutColumns(serialize(world), 17, views, []);

    const loaded = deserialize(oldSave);

    expect(loaded.guests.cols.voucherKind[guest]).toBe(VoucherKind.None);
    expect(loaded.guests.cols.voucherTarget[guest]).toBe(-1);
  });
});

describe('save: guest history and satiation migration', () => {
  it.each([8, 9, 10, 11])(
    'migrates version %s guest columns and hunger/thirst scale',
    (version) => {
      const world = flatWorld(16);
      const guest = guestAt(world, 4, 5);
      world.guests.cols.hunger[guest] = 30;
      world.guests.cols.thirst[guest] = 50;
      world.guests.cols.wanderSteps[guest] = 12;
      const views = [
        ...world.map.arrays(),
        ...world.guests.arrays(),
        ...world.staff.arrays(),
        ...world.vehicles.arrays(),
        ...world.litter.arrays(),
        ...world.rides.arrays(),
        ...world.track.pieces.arrays(),
        ...world.track.rideTables(),
      ];
      const absent = [
        world.guests.cols.visitTicks,
        world.guests.cols.ridesTaken,
        world.guests.cols.lastRide,
        ...(version <= 9 ? navigationColumns(world) : []),
        ...(version === 8
          ? [
              world.guests.cols.wanderSteps,
              world.rides.cols.trainCount,
              world.rides.cols.carsPerTrain,
            ]
          : []),
        ...(version <= 10 ? reliabilityColumns(world) : []),
        ...(version <= 12 ? riderHistoryColumns(world) : []),
      ];
      const oldSave = withoutColumns(serialize(world), version, views, absent);

      const loaded = deserialize(oldSave);

      expect(loaded.guests.cols.hunger[guest]).toBe(225);
      expect(loaded.guests.cols.thirst[guest]).toBe(205);
      expect(loaded.guests.cols.visitTicks[guest]).toBe(0);
      expect(loaded.guests.cols.ridesTaken[guest]).toBe(0);
      expect(loaded.guests.cols.lastRide[guest]).toBe(-1);
      expect(loaded.guests.cols.wanderSteps[guest]).toBe(0);
    },
  );

  it('maps legacy nausea tolerance bytes back into the four audited buckets', () => {
    const world = flatWorld(16);
    const oldValues = [96, 116, 156, 216];
    oldValues.forEach((value, index) => {
      const guest = guestAt(world, 4 + index, 5);
      world.guests.cols.nauseaTolerance[guest] = value;
    });
    const views = [
      ...world.map.arrays(),
      ...world.guests.arrays(),
      ...world.staff.arrays(),
      ...world.vehicles.arrays(),
      ...world.litter.arrays(),
      ...world.rides.arrays(),
      ...world.track.pieces.arrays(),
      ...world.track.rideTables(),
    ];
    const oldSave = withoutColumns(serialize(world), 9, views, [
      world.guests.cols.visitTicks,
      world.guests.cols.ridesTaken,
      world.guests.cols.lastRide,
      ...navigationColumns(world),
      ...reliabilityColumns(world),
    ]);

    const loaded = deserialize(oldSave);

    expect(Array.from(loaded.guests.cols.nauseaTolerance.slice(0, oldValues.length))).toEqual([
      0, 1, 2, 3,
    ]);
  });
});

describe('save: economy, research and scenario state', () => {
  it('preserves locked ride types across save and load and rejects construction afterward', () => {
    const sim = new Simulation({ seed: 5, width: 16, height: 16 });
    sim.world.research.unlocked.add(RideType.MerryGoRound);

    const loaded = new Simulation(deserialize(serialize(sim.world)));
    loaded.enqueue({ type: 'createRide', rideType: RideType.MerryGoRound, x: 5, y: 6 });
    loaded.step();

    expect(loaded.world.rides.count).toBe(1);
    const cash = loaded.world.economy.cash;
    loaded.enqueue({ type: 'createRide', rideType: RideType.TopSpin, x: 5, y: 6 });

    loaded.step();

    expect(loaded.world.rides.count).toBe(1);
    expect(loaded.world.economy.cash).toBe(cash);
    expect(loaded.world.feedback.code).toBe(RideResult.ResearchRequired);
  });

  it('round-trips finance, research and scenario state exactly', () => {
    const sim = new Simulation({ seed: 5, width: 16, height: 16 });
    applyScenario(sim.world, {
      id: 'save',
      name: 'save',
      seed: 5,
      mapWidth: 16,
      mapHeight: 16,
      startingCash: 5_000_000,
      startingLoan: 0,
      maxLoan: 10_000_000,
      annualInterestBps: 1_000,
      averageGuestCashCents: 5_000,
      difficultRating: false,
      priceMode: 1,
      admissionPrice: 200,
      availableItemIds: [7],
      inventions: [{ itemId: 8, category: 0, workUnits: 10_000 }],
      objective: { kind: 0, target: 100, rating: 0, categoryMask: 0, byTick: 40_000 },
    });
    sim.enqueue({ type: 'research', action: { type: 'setCategories', mask: 1 } });
    sim.enqueue({ type: 'research', action: { type: 'setFunding', level: 2 } });
    for (let i = 0; i < 5000; i++) sim.step();
    const loaded = deserialize(serialize(sim.world));
    expect(hashWorld(loaded)).toBe(hashWorld(sim.world));
    expect(loaded.economy.history).toEqual(sim.world.economy.history);
    expect(loaded.research.inventions).toEqual(sim.world.research.inventions);
  });
});

describe('save: map and economy together', () => {
  it('round-trips map edits alongside economy state and continues identically', () => {
    const make = () => {
      const sim = new Simulation({ seed: 9, width: 24, height: 24, maxGuests: 200 });
      applyScenario(sim.world, {
        id: 'combined',
        name: 'combined',
        seed: 9,
        mapWidth: 24,
        mapHeight: 24,
        startingCash: 50_000_000,
        startingLoan: 1_000_000,
        maxLoan: 10_000_000,
        annualInterestBps: 1_000,
        averageGuestCashCents: 5_000,
        difficultRating: false,
        priceMode: 1,
        admissionPrice: 300,
        availableItemIds: [],
        inventions: [],
        objective: { kind: 0, target: 100, rating: 0, categoryMask: 0, byTick: 40_000 },
      });
      return sim;
    };
    const untouched = hashWorld(make().world);
    const sim = make();
    sim.enqueue({ type: 'buyLand', x: 2, y: 2, width: 8, height: 8, rights: true });
    sim.enqueue({ type: 'raiseLand', x: 3, y: 3, width: 3, height: 3 });
    sim.enqueue({ type: 'setWater', x: 6, y: 6, width: 2, height: 2, level: 2 });
    sim.enqueue({ type: 'paintLand', x: 2, y: 2, width: 2, height: 2, surface: 1 });
    sim.enqueue({ type: 'placePath', x: 2, y: 8 });
    sim.enqueue({ type: 'research', action: { type: 'setFunding', level: 2 } });
    sim.enqueue({ type: 'spawnGuests', count: 20 });
    const ride = sim.world.rides.slotToId[sim.world.rides.spawn()];
    sim.enqueue({
      type: 'placeTrack',
      rideId: ride,
      pieceType: PieceId.Station,
      x: 10,
      y: 10,
      z: 4,
      dir: 0,
      mode: 0,
    });
    for (let i = 0; i < 300; i++) sim.step();
    expect(hashWorld(sim.world)).not.toBe(untouched);

    const loaded = deserialize(serialize(sim.world));
    expect(hashWorld(loaded)).toBe(hashWorld(sim.world));
    for (const [a, b] of sim.world.map.arrays().map((arr, i) => [arr, loaded.map.arrays()[i]])) {
      expect(Array.from(b as unknown as ArrayLike<number>)).toEqual(
        Array.from(a as unknown as ArrayLike<number>),
      );
    }
    expect(loaded.economy.cash).toBe(sim.world.economy.cash);
    expect(sim.world.track.pieces.count).toBeGreaterThan(0);
    expect(loaded.track.pieces.count).toBe(sim.world.track.pieces.count);
    for (const [a, b] of sim.world.track.pieces
      .arrays()
      .concat(sim.world.track.rideTables())
      .map((arr, i) => [arr, loaded.track.pieces.arrays().concat(loaded.track.rideTables())[i]])) {
      expect(Array.from(b as unknown as ArrayLike<number>)).toEqual(
        Array.from(a as unknown as ArrayLike<number>),
      );
    }
    expect(loaded.track.lastResult).toBe(sim.world.track.lastResult);

    const copy = make();
    Object.assign(copy, { world: loaded });
    for (let i = 0; i < 100; i++) {
      sim.step();
      copy.step();
    }
    expect(hashWorld(copy.world)).toBe(hashWorld(sim.world));
  });

  it('flattens stepped water into one sheet when loading a version 20 save', () => {
    const sim = new Simulation({ seed: 46, width: 16, height: 16 });
    const m = sim.world.map;
    m.fillFlat(2);
    for (const [x, level] of [
      [4, 5],
      [5, 4],
      [6, 3],
    ])
      m.waterLevel[m.index(x, 8)] = level;
    m.waterLevel[m.index(10, 10)] = 6;
    const current = serialize(sim.world);
    const dataView = new DataView(current.buffer, current.byteOffset, current.byteLength);
    const headerEnd = 8 + dataView.getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(current.subarray(8, headerEnd)));
    header.version = 20;
    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const legacy = new Uint8Array(8 + headerBytes.length + current.length - headerEnd);
    new DataView(legacy.buffer).setUint32(0, dataView.getUint32(0, true), true);
    new DataView(legacy.buffer).setUint32(4, headerBytes.length, true);
    legacy.set(headerBytes, 8);
    legacy.set(current.subarray(headerEnd), 8 + headerBytes.length);

    const restored = deserialize(legacy).map;

    for (const x of [4, 5, 6]) expect(restored.waterLevel[restored.index(x, 8)]).toBe(3);
    expect(restored.waterLevel[restored.index(10, 10)]).toBe(6);
  });

  it('rejects saves from an older format version', () => {
    const bytes = serialize(new Simulation({ seed: 1, width: 8, height: 8 }).world);
    const headerLen = new DataView(bytes.buffer).getUint32(4, true);
    const header = new TextDecoder().decode(bytes.subarray(8, 8 + headerLen));
    const old = header.replace(
      `"version":${SAVE_VERSION}`,
      `"version":2${' '.repeat(String(SAVE_VERSION).length - 1)}`,
    );
    expect(old).not.toBe(header);
    const patched = new Uint8Array(bytes);
    patched.set(new TextEncoder().encode(old), 8);
    expect(() => deserialize(patched)).toThrow(/Unsupported save version/);
  });
});

/** Guest columns added in save version 10. */
function navigationColumns(world: World): ArrayBufferView[] {
  const c = world.guests.cols;
  return [c.navGoal, c.pathCursor, c.navSteps, c.lostTicks, c.hasMap];
}

/** Version 12 and earlier did not contain guest history or per-worker task orders. */
function v12Columns(world: World): ArrayBufferView[] {
  const guests = world.guests.cols;
  return [
    guests.rideHistoryCursor,
    guests.rideHistory0,
    guests.rideHistory1,
    guests.rideHistory2,
    guests.rideHistory3,
    world.staff.cols.orderFlags,
  ];
}

/** Ride columns that saves before version 11 did not have. */
function reliabilityColumns(world: ReturnType<typeof flatWorld>): ArrayBufferView[] {
  const cols = world.rides.cols;
  return [
    cols.reliabilityRaw,
    cols.mode,
    cols.breakdownReason,
    cols.serviceTicks,
    cols.serviceLastTick,
  ];
}

function riderHistoryColumns(world: ReturnType<typeof flatWorld>): ArrayBufferView[] {
  const columns = world.rides.cols as unknown as Record<string, Uint16Array>;
  return Array.from(
    { length: RIDER_HISTORY_WINDOWS },
    (_, index) => columns[`ridersWindow${String(index).padStart(2, '0')}`],
  );
}

describe('save: version 4 migration', () => {
  function versionFourSave(world: ReturnType<typeof flatWorld>): Uint8Array {
    const current = serialize(world);
    const dv = new DataView(current.buffer, current.byteOffset, current.byteLength);
    const headerEnd = 8 + dv.getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(current.subarray(8, headerEnd)));
    header.version = 4;
    delete header.park;
    delete header.patrolAreas;
    delete header.umbrellas;
    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const arrays = world.map
      .arrays()
      .slice(0, -1)
      .concat(
        legacyGuestArrays(world),
        world.staff.arrays().slice(0, -1),
        world.vehicles.arrays(),
        world.litter.arrays(),
        world.rides.arrays().slice(0, -5 - RIDE_COLUMNS_ADDED_IN_V10 - RIDER_HISTORY_WINDOWS),
        world.track.pieces.arrays(),
        world.track.rideTables(),
      );
    const total = arrays.reduce((n, a) => n + a.byteLength, 0);
    const out = new Uint8Array(8 + headerBytes.length + total);
    const view = new DataView(out.buffer);
    view.setUint32(0, dv.getUint32(0, true), true);
    view.setUint32(4, headerBytes.length, true);
    out.set(headerBytes, 8);
    let offset = 8 + headerBytes.length;
    for (const a of arrays) {
      out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), offset);
      offset += a.byteLength;
    }
    return out;
  }

  it('loads guests saved before headings existed and keeps them walking', () => {
    const world = flatWorld(16);
    spawnStaff(world, StaffKind.Handyman);
    world.economy.inputs.wageBillPerWeek = 0;
    layPath(world, row(5, 2, 12));
    for (let i = 0; i < 5; i++) guestAt(world, 2 + i, 5);
    world.guests.cols.x[1] += 37;
    world.guests.cols.state[2] = 1;
    world.guests.cols.targetRide[2] = 0;
    const loaded = deserialize(versionFourSave(world));
    expect(loaded.guests.count).toBe(5);
    expect(loaded.economy.inputs.wageBillPerWeek).toBe(1_250);
    expect(loaded.park.entranceX).toBe(-1);
    for (let slot = 0; slot < 5; slot++) {
      if (slot !== 1) expect(loaded.guests.cols.x[slot]).toBe(world.guests.cols.x[slot]);
      expect(loaded.guests.cols.cash[slot]).toBe(world.guests.cols.cash[slot]);
      expect(loaded.guests.cols.heading[slot]).toBe(HEADING_NONE);
    }
    expect(loaded.guests.cols.state[2]).toBe(0);
    expect(loaded.guests.cols.targetRide[2]).toBe(-1);
    const sim = new Simulation({ seed: 1, width: 16, height: 16 });
    Object.assign(sim, { world: loaded });
    for (let i = 0; i < 200; i++) sim.step();
    const [tileX, tileY] = [loaded.guests.cols.x[1] >> 8, loaded.guests.cols.y[1] >> 8];
    expect(loaded.map.isWalkable(loaded.map.index(tileX, tileY))).toBe(true);
    expect(loaded.guests.cols.heading[1]).toBeLessThan(HEADING_NONE);
    expect(loaded.guests.slotToId[4]).toBe(world.guests.slotToId[4]);
    expect(Array.from(loaded.map.heights)).toEqual(Array.from(world.map.heights));
  });

  it('loads version 5 saves with default patrol masks and umbrella ownership', () => {
    const world = flatWorld(16);
    spawnStaff(world, StaffKind.Handyman);
    world.economy.inputs.wageBillPerWeek = 0;
    const current = serialize(world);
    const headerLen = new DataView(current.buffer).getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(current.subarray(8, 8 + headerLen)));
    header.version = 5;
    delete header.patrolAreas;
    delete header.umbrellas;
    const encoded = new TextEncoder().encode(JSON.stringify(header));
    const legacy = new Uint8Array(8 + encoded.length + current.length - 8 - headerLen);
    legacy.set(current.subarray(0, 8));
    new DataView(legacy.buffer).setUint32(4, encoded.length, true);
    legacy.set(encoded, 8);
    legacy.set(current.subarray(8 + headerLen), 8 + encoded.length);

    const loaded = deserialize(legacy);

    expect(loaded.patrolAreas.every((value) => value === 0)).toBe(true);
    expect(loaded.umbrellas.every((value) => value === 0)).toBe(true);
    expect(loaded.economy.inputs.wageBillPerWeek).toBe(1_250);
    expect(loaded.park.entranceX).toBe(world.park.entranceX);
  });

  it('migrates version 8 saves with default train layout and approach gap', () => {
    const world = flatWorld(16);
    const rideSlot = world.rides.spawn();
    world.rides.cols.price[rideSlot] = 275;
    world.rides.cols.incomeCents[rideSlot] = 99_999;
    const views = [
      ...world.map.arrays(),
      ...world.guests.arrays(),
      ...world.staff.arrays(),
      ...world.vehicles.arrays(),
      ...world.litter.arrays(),
      ...world.rides.arrays(),
      ...world.track.pieces.arrays(),
      ...world.track.rideTables(),
    ];
    const legacy = withoutColumns(serialize(world), 8, views, [
      world.guests.cols.visitTicks,
      world.guests.cols.ridesTaken,
      world.guests.cols.lastRide,
      world.guests.cols.wanderSteps,
      ...navigationColumns(world),
      ...v12Columns(world),
      world.rides.cols.trainCount,
      world.rides.cols.carsPerTrain,
      ...reliabilityColumns(world),
      ...riderHistoryColumns(world),
    ]);

    const loaded = deserialize(legacy);

    expect(loaded.rides.cols.incomeCents[rideSlot]).toBe(99_999);
    expect(loaded.rides.cols.trainCount[rideSlot]).toBe(0);
    expect(loaded.rides.cols.carsPerTrain[rideSlot]).toBe(0);
  });

  it('migrates version 9 saves with guests that are neither lost nor holding a map', () => {
    const world = flatWorld(16);
    layPath(world, row(5, 2, 8));
    const slot = guestAt(world, 2, 5);
    world.guests.cols.happiness[slot] = 77;
    world.guests.cols.hasMap[slot] = 1;
    world.guests.cols.lostTicks[slot] = 500;
    const views = [
      ...world.map.arrays(),
      ...world.guests.arrays(),
      ...world.staff.arrays(),
      ...world.vehicles.arrays(),
      ...world.litter.arrays(),
      ...world.rides.arrays(),
      ...world.track.pieces.arrays(),
      ...world.track.rideTables(),
    ];
    const legacy = withoutColumns(serialize(world), 9, views, [
      ...navigationColumns(world),
      world.guests.cols.visitTicks,
      world.guests.cols.ridesTaken,
      world.guests.cols.lastRide,
      ...v12Columns(world),
      ...riderHistoryColumns(world),
    ]);

    const loaded = deserialize(legacy);

    expect(loaded.guests.cols.happiness[slot]).toBe(77);
    expect(loaded.guests.cols.hasMap[slot]).toBe(0);
    expect(loaded.guests.cols.lostTicks[slot]).toBe(0);
  });

  it('migrates version 10 saves while preserving guest navigation and research units', () => {
    const world = flatWorld(16);
    layPath(world, row(5, 2, 8));
    const guestSlot = guestAt(world, 2, 5);
    world.guests.cols.navGoal[guestSlot] = 3;
    world.guests.cols.pathCursor[guestSlot] = 2;
    world.guests.cols.navSteps[guestSlot] = 7;
    world.guests.cols.lostTicks[guestSlot] = 500;
    world.guests.cols.hasMap[guestSlot] = 1;
    world.research.inventions = [{ itemId: 8, category: 0, workUnits: 21 }];
    const rideSlot = world.rides.spawn();
    world.rides.cols.typeId[rideSlot] = RideType.FerrisWheel;
    world.rides.cols.reliability[rideSlot] = 64;
    const views = [
      ...world.map.arrays(),
      ...world.guests.arrays(),
      ...world.staff.arrays(),
      ...world.vehicles.arrays(),
      ...world.litter.arrays(),
      ...world.rides.arrays(),
      ...world.track.pieces.arrays(),
      ...world.track.rideTables(),
    ];
    const legacy = withoutColumns(serialize(world), 10, views, [
      ...reliabilityColumns(world),
      world.guests.cols.visitTicks,
      world.guests.cols.ridesTaken,
      world.guests.cols.lastRide,
      ...v12Columns(world),
      ...riderHistoryColumns(world),
    ]);

    const loaded = deserialize(legacy);

    expect(loaded.guests.cols.navGoal[guestSlot]).toBe(0);
    expect(loaded.guests.cols.pathCursor[guestSlot]).toBe(0);
    expect(loaded.guests.cols.navSteps[guestSlot]).toBe(7);
    expect(loaded.guests.cols.lostTicks[guestSlot]).toBe(500);
    expect(loaded.guests.cols.hasMap[guestSlot]).toBe(1);
    expect(loaded.research.inventions).toEqual([{ itemId: 8, category: 0, workUnits: 21 }]);
    expect(loaded.rides.cols.reliabilityRaw[rideSlot]).toBe(64 * 256);
    expect(loaded.rides.cols.mode[rideSlot]).toBe(RIDE_CATALOG[RideType.FerrisWheel].modes[0].mode);
    expect(deserialize(serialize(loaded)).rides.cols.reliabilityRaw[rideSlot]).toBe(64 * 256);
  });

  it('migrates version 12 ride history as empty while preserving guest history', () => {
    const world = flatWorld(16);
    const rideSlot = world.rides.spawn();
    world.rides.cols.reliabilityRaw[rideSlot] = 17_321;
    (world.rides.cols as unknown as Record<string, Uint16Array>).ridersWindow00[rideSlot] = 25;
    const views = [
      ...world.map.arrays(),
      ...world.guests.arrays(),
      ...world.staff.arrays(),
      ...world.vehicles.arrays(),
      ...world.litter.arrays(),
      ...world.rides.arrays(),
      ...world.track.pieces.arrays(),
      ...world.track.rideTables(),
    ];
    world.guests.cols.visitTicks[0] = 64;
    world.guests.cols.ridesTaken[0] = 3;
    world.guests.cols.lastRide[0] = 7;
    const legacy = withoutColumns(serialize(world), 12, views, [
      ...v12Columns(world),
      ...riderHistoryColumns(world),
    ]);

    const loaded = deserialize(legacy);

    expect(loaded.rides.cols.reliabilityRaw[rideSlot]).toBe(17_321);
    expect(loaded.guests.cols.visitTicks[0]).toBe(64);
    expect(loaded.guests.cols.ridesTaken[0]).toBe(3);
    expect(loaded.guests.cols.lastRide[0]).toBe(7);
    expect(
      (loaded.rides.cols as unknown as Record<string, Uint16Array>).ridersWindow00[rideSlot],
    ).toBe(0);
  });

  it.each([6, 7])('migrates version %s ride records with zeroed lifetime income', (version) => {
    const world = flatWorld(16);
    const rideSlot = world.rides.spawn();
    world.rides.cols.price[rideSlot] = 275;
    world.rides.cols.incomeCents[rideSlot] = 99_999;
    const oldViews = [
      ...world.map.arrays(),
      ...world.guests.arrays(),
      ...world.staff.arrays(),
      ...world.vehicles.arrays(),
      ...world.litter.arrays(),
      ...world.rides.arrays(),
      ...world.track.pieces.arrays(),
      ...world.track.rideTables(),
    ];
    const legacy = withoutColumns(serialize(world), version, oldViews, [
      world.guests.cols.visitTicks,
      world.guests.cols.ridesTaken,
      world.guests.cols.lastRide,
      world.guests.cols.wanderSteps,
      ...navigationColumns(world),
      world.guests.cols.rideHistoryCursor,
      world.guests.cols.rideHistory0,
      world.guests.cols.rideHistory1,
      world.guests.cols.rideHistory2,
      world.guests.cols.rideHistory3,
      world.staff.cols.orderFlags,
      world.rides.cols.incomeCents,
      world.rides.cols.trainCount,
      world.rides.cols.carsPerTrain,
      ...reliabilityColumns(world),
      ...riderHistoryColumns(world),
    ]);

    const loaded = deserialize(legacy);

    expect(loaded.rides.cols.price[rideSlot]).toBe(275);
    expect(loaded.rides.cols.incomeCents[rideSlot]).toBe(0);
  });
});

describe('save: version 8 research migration', () => {
  /** Rewrites a current save's header as version 8: invention costs and progress in cents. */
  function versionEightSave(world: ReturnType<typeof flatWorld>, costCents: number): Uint8Array {
    const current = serialize(world);
    const dv = new DataView(current.buffer, current.byteOffset, current.byteLength);
    const headerEnd = 8 + dv.getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(current.subarray(8, headerEnd)));
    header.version = 8;
    header.research.inventions = header.research.inventions.map(
      (inv: { itemId: number; category: number }) => ({ ...inv, costCents }),
    );
    delete header.research.inventions[0].workUnits;
    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const out = new Uint8Array(8 + headerBytes.length + current.length - headerEnd);
    out.set(current.subarray(0, 8), 0);
    new DataView(out.buffer).setUint32(4, headerBytes.length, true);
    out.set(headerBytes, 8);
    out.set(current.subarray(headerEnd), 8 + headerBytes.length);
    return out;
  }

  it('keeps each invention at its minimum-funding duration when an old save loads', () => {
    const world = flatWorld();
    world.research.inventions = [{ itemId: 8, category: 0, workUnits: 21 }];
    const loaded = deserialize(versionEightSave(world, 2_500));
    expect(loaded.research.inventions).toEqual([{ itemId: 8, category: 0, workUnits: 21 }]);
  });
});

describe('save: queue lines', () => {
  it('keeps the queue tiles of a version 20 save, linked to the adjacent entrance', () => {
    const w = flatWorld();
    layPath(w, row(5, 2, 4));
    layPath(w, row(5, 5, 7), true);
    layPath(w, [[9, 3]]);
    const id = createRide(w, RideType.MerryGoRound, 7, 3);
    placeRideEntranceExit(w, id, { x: 7, y: 5 }, { x: 9, y: 3 });
    refreshQueueIndex(w);
    for (let i = 0; i < w.map.width * w.map.height; i++)
      for (let e = w.map.firstElement(i); e >= 0; e = w.map.nextElement(e))
        w.map.elData[e] &= ~PATH_BOARDING_MARKS;

    const legacy = withoutColumns(serialize(w), 20, allWorldViews(w), [
      w.guests.cols.queueSeq,
      w.rides.cols.queueSerial,
      w.rides.cols.queueLimit,
    ]);
    const loaded = deserialize(legacy);
    refreshQueueIndex(loaded);

    const slot = loaded.rides.idToSlot[id];
    expect(loaded.queues.hasQueue[slot]).toBe(1);
    expect(loaded.queues.tiles[slot]).toBe(2);
    expect(loaded.queues.joinTile[slot]).toBe(loaded.map.index(4, 5));
    expect(loaded.map.isQueue(loaded.map.index(6, 5))).toBe(true);
    expect(loaded.rides.cols.queueLimit[slot]).toBe(0);
  });
});

describe('save: ride downtime window', () => {
  function worldWithDowntime(): { w: World; id: number } {
    const w = flatWorld();
    const id = createRide(w, RideType.Twist, 4, 4);
    breakRide(w, w.rides.idToSlot[id], BreakdownReason.SafetyCutOut);
    for (let i = 0; i < 8192 / 256; i++) {
      w.tick += 256;
      updateRideMaintenance(w);
    }
    return { w, id };
  }

  it('round-trips the rolling downtime and keeps counting from it', () => {
    const { w, id } = worldWithDowntime();
    const loaded = deserialize(serialize(w));
    expect(getRideDowntimePercent(loaded, id)).toBe(getRideDowntimePercent(w, id));
    expect(getRideDowntimePercent(loaded, id)).toBeGreaterThan(0);
    for (const world of [w, loaded]) {
      world.tick += 8192;
      updateRideMaintenance(world);
    }
    expect(getRideDowntimePercent(loaded, id)).toBe(getRideDowntimePercent(w, id));
  });

  it('loads a version 27 save with an empty downtime window', () => {
    const { w, id } = worldWithDowntime();
    const legacy = withoutColumns(serialize(w), 27, allWorldViews(w), []);
    const loaded = deserialize(legacy);
    expect(getRideDowntimePercent(loaded, id)).toBe(0);
    expect(loaded.rides.cols.reliabilityRaw[loaded.rides.idToSlot[id]]).toBe(
      w.rides.cols.reliabilityRaw[w.rides.idToSlot[id]],
    );
  });
});

describe('save: guest wayfinding state', () => {
  function wayfinder(): { w: World; stayer: number; leaver: number } {
    const w = flatWorld(16);
    layPath(w, row(5, 2, 8));
    const stayer = guestAt(w, 4, 5);
    const leaver = guestAt(w, 6, 5);
    const g = w.guests.cols;
    g.lostCountdown[stayer] = 77;
    g.wanderSteps[stayer] = 300;
    g.navGoal[stayer] = 9;
    g.pathCursor[stayer] = 2;
    g.pathHistory0[stayer] = (70 << 4) | 3;
    g.pathHistory3[stayer] = (12 << 4) | 8;
    g.state[leaver] = GuestState.Leaving;
    return { w, stayer, leaver };
  }

  it('round trips the countdown, wander count and junction memory', () => {
    const { w, stayer } = wayfinder();
    const loaded = deserialize(serialize(w));
    const g = loaded.guests.cols;
    expect(g.lostCountdown[stayer]).toBe(77);
    expect(g.wanderSteps[stayer]).toBe(300);
    expect(g.navGoal[stayer]).toBe(9);
    expect(g.pathCursor[stayer]).toBe(2);
    expect(g.pathHistory0[stayer]).toBe((70 << 4) | 3);
    expect(g.pathHistory3[stayer]).toBe((12 << 4) | 8);
  });

  it('loads a version 31 save with empty memory and the exit countdown running for leavers', () => {
    const { w, stayer, leaver } = wayfinder();
    const loaded = deserialize(withoutColumns(serialize(w), 31, allWorldViews(w), []));
    const g = loaded.guests.cols;
    expect(g.lostCountdown[stayer]).toBe(0);
    expect(g.wanderSteps[stayer]).toBe(0);
    expect(g.navGoal[stayer]).toBe(0);
    expect(g.pathCursor[stayer]).toBe(0);
    expect(g.pathHistory0[stayer]).toBe(0);
    expect(g.lostCountdown[leaver]).toBe(LEAVING_COUNTDOWN);
    expect(g.state[leaver]).toBe(GuestState.Leaving);
  });

  it('loads version 32 staff and guest sight data before adding wayfinding fields', () => {
    const { w, stayer, leaver } = wayfinder();
    w.guests.cols.sightMemory[stayer] = 0x12345678;
    expect(spawnStaff(w, StaffKind.Handyman)).toBe(true);
    w.staff.cols.lawnsMown[0] = 14;

    const loaded = deserialize(withoutColumns(serialize(w), 32, allWorldViews(w), []));
    const g = loaded.guests.cols;

    expect(g.sightMemory[stayer]).toBe(0x12345678);
    expect(loaded.staff.cols.lawnsMown[0]).toBe(14);
    expect(g.lostCountdown[stayer]).toBe(0);
    expect(g.navGoal[stayer]).toBe(0);
    expect(g.pathHistory0[stayer]).toBe(0);
    expect(g.lostCountdown[leaver]).toBe(LEAVING_COUNTDOWN);
  });
});
