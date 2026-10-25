import { describe, expect, it } from 'vitest';
import { hashWorld } from '../core/hash';
import { Simulation } from '../core/simulation';
import { World } from '../core/world';
import { Surface } from '../map/tile-map';
import { legacyGuestArrays } from '../integration/fixtures';
import { StaffKind, spawnStaff } from '../staff/staff-store';
import { deserialize, serialize } from '../../save/save';
import {
  RIDE_CATALOG,
  RidePhase,
  RideType,
  calculateRideThroughputPerHour,
  connectRideQueue,
  configureRide,
  createRide,
  getRideAgeMonths,
  getRideBoardedCount,
  getRideCapacity,
  getRideDowntimeTicks,
  getRideGuestsServed,
  getRidePhase,
  getRidePriceReaction,
  getRideQueueLength,
  getRideRatings,
  getRideTestMeasurements,
  getRideValueCents,
  getEstimatedRideWaitTicks,
  isRideInspectionDue,
  isRideTested,
  joinRideQueue,
  placeRideEntranceExit,
  recordRideTestMeasurements,
  setRidePrice,
  setRideOpen,
  inspectRide,
  triggerRideBreakdown,
  rideSystem,
} from './index';

function world(): World {
  return new World({ seed: 17, width: 16, height: 16 });
}

function preparedRide(w: World, type = RideType.MerryGoRound): number {
  const id = createRide(w, type, 4, 4);
  expect(placeRideEntranceExit(w, id, { x: 4, y: 5 }, { x: 5, y: 4 })).toBe(true);
  w.map.surface[w.map.index(3, 5)] = Surface.Path;
  w.map.surface[w.map.index(3, 6)] = Surface.Path;
  w.map.surface[w.map.index(3, 7)] = Surface.Path;
  w.map.surface[w.map.index(4, 7)] = Surface.Path;
  w.map.surface[w.map.index(5, 7)] = Surface.Path;
  expect(
    connectRideQueue(w, id, [
      { x: 4, y: 5 },
      { x: 3, y: 5 },
      { x: 3, y: 6 },
      { x: 3, y: 7 },
      { x: 4, y: 7 },
      { x: 5, y: 7 },
    ]),
  ).toBe(true);
  return id;
}

function preRidesSave(w: World): Uint8Array {
  const current = serialize(w);
  const dataView = new DataView(current.buffer, current.byteOffset, current.byteLength);
  const headerEnd = 8 + dataView.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(current.subarray(8, headerEnd)));
  header.version = 3;
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const [slotToId, idToSlot, freeIds] = w.rides.arrays();
  const oldArrays = [
    ...w.map.arrays(),
    ...legacyGuestArrays(w),
    ...w.staff
      .arrays()
      .filter(
        (array) =>
          array !== w.staff.cols.orderFlags &&
          array !== w.staff.cols.sweeps &&
          array !== w.staff.cols.vandalsStopped,
      ),
    ...w.vehicles.arrays(),
    ...w.litter.arrays().filter((array) => array !== w.litter.cols.birthOrder),
    slotToId,
    idToSlot,
    freeIds,
    w.rides.cols.typeId,
    w.rides.cols.state,
    w.rides.cols.entranceX,
    w.rides.cols.entranceY,
    w.rides.cols.excitement,
    w.rides.cols.intensity,
    w.rides.cols.nausea,
    w.rides.cols.price,
    w.rides.cols.queueLength,
    w.rides.cols.reliability,
    w.rides.cols.breakdownCounter,
    ...w.track.pieces.arrays(),
    ...w.track.rideTables(),
  ];
  const rawBytes = oldArrays.reduce((total, array) => total + array.byteLength, 0);
  const legacy = new Uint8Array(8 + headerBytes.length + rawBytes);
  const legacyView = new DataView(legacy.buffer);
  legacyView.setUint32(0, dataView.getUint32(0, true), true);
  legacyView.setUint32(4, headerBytes.length, true);
  legacy.set(headerBytes, 8);
  let offset = 8 + headerBytes.length;
  for (const array of oldArrays) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    legacy.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return legacy;
}

describe('ride catalog and placement', () => {
  it('provides the requested placeholder rides and service stalls', () => {
    const rides = Object.values(RIDE_CATALOG);
    const names = rides.map((ride) => ride.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'Merry-Go-Round',
        'Swinging Ship',
        'Ferris Wheel',
        'Twist',
        'Food Stall',
        'Drink Stall',
        'Information Kiosk',
        'Toilets',
      ]),
    );
  });

  it('opens only after entrance, exit, and a connected queue line are placed', () => {
    const w = world();
    const id = createRide(w, RideType.FerrisWheel, 4, 4);

    expect(setRideOpen(w, id, true)).toBe(false);
    expect(placeRideEntranceExit(w, id, { x: 10, y: 10 }, { x: 11, y: 10 })).toBe(false);
    expect(placeRideEntranceExit(w, id, { x: 4, y: 5 }, { x: 5, y: 4 })).toBe(true);
    expect(setRideOpen(w, id, true)).toBe(false);
    w.map.surface[w.map.index(4, 5)] = Surface.Path;
    w.map.surface[w.map.index(3, 5)] = Surface.Path;
    expect(
      connectRideQueue(w, id, [
        { x: 4, y: 5 },
        { x: 3, y: 5 },
      ]),
    ).toBe(true);

    expect(setRideOpen(w, id, true)).toBe(true);
  });

  it('rejects a queue line that is disconnected from the entrance or park path', () => {
    const w = world();
    const id = createRide(w, RideType.MerryGoRound, 4, 4);
    expect(placeRideEntranceExit(w, id, { x: 4, y: 5 }, { x: 5, y: 4 })).toBe(true);
    w.map.surface[w.map.index(8, 8)] = Surface.Path;

    expect(
      connectRideQueue(w, id, [
        { x: 7, y: 8 },
        { x: 8, y: 8 },
      ]),
    ).toBe(false);
    expect(
      connectRideQueue(w, id, [
        { x: 4, y: 5 },
        { x: 3, y: 5 },
      ]),
    ).toBe(false);
  });

  it('rejects queue chains that cross non-path tiles', () => {
    const w = world();
    const id = createRide(w, RideType.MerryGoRound, 4, 4);
    expect(placeRideEntranceExit(w, id, { x: 4, y: 5 }, { x: 5, y: 4 })).toBe(true);
    w.map.surface[w.map.index(2, 5)] = Surface.Path;

    expect(
      connectRideQueue(w, id, [
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 2, y: 5 },
      ]),
    ).toBe(false);
  });
});

describe('ride operation cycles', () => {
  it('reports an estimated wait from queue length and the service cycle', () => {
    const w = world();
    const id = preparedRide(w);
    expect(setRideOpen(w, id, true)).toBe(true);
    expect(joinRideQueue(w, id, 2)).toBe(true);

    expect(getRideQueueLength(w, id)).toBe(2);
    expect(getEstimatedRideWaitTicks(w, id)).toBe(60);
  });

  it('rejects queue reconnection while open so capacity cannot shrink under waiting guests', () => {
    const w = world();
    const id = preparedRide(w);
    expect(setRideOpen(w, id, true)).toBe(true);
    expect(joinRideQueue(w, id, 2)).toBe(true);

    expect(
      connectRideQueue(w, id, [
        { x: 4, y: 5 },
        { x: 3, y: 5 },
      ]),
    ).toBe(false);
    expect(getRideQueueLength(w, id)).toBe(2);
  });

  it('rejects a closed ride queue reconnection below its retained occupancy', () => {
    const w = world();
    const id = preparedRide(w);
    expect(setRideOpen(w, id, true)).toBe(true);
    expect(joinRideQueue(w, id, 2)).toBe(true);
    expect(setRideOpen(w, id, false)).toBe(true);

    expect(
      connectRideQueue(w, id, [
        { x: 4, y: 5 },
        { x: 3, y: 5 },
      ]),
    ).toBe(false);
    expect(getRideQueueLength(w, id)).toBe(2);
  });

  it('waits the minimum, then dispatches at the configured load threshold', () => {
    const w = world();
    const id = preparedRide(w);
    configureRide(w, id, { minWaitTicks: 2, maxWaitTicks: 8, loadThreshold: 128 });
    expect(setRideOpen(w, id, true)).toBe(true);
    expect(joinRideQueue(w, id, getRideCapacity(w, id))).toBe(true);

    rideSystem.update(w);
    expect(getRidePhase(w, id)).toBe(RidePhase.Waiting);
    rideSystem.update(w);

    expect(getRidePhase(w, id)).toBe(RidePhase.Loading);
    expect(getRideBoardedCount(w, id)).toBe(getRideCapacity(w, id));
  });

  it('lets maximum wait dispatch a partial load but never bypasses minimum wait', () => {
    const w = world();
    const id = preparedRide(w);
    configureRide(w, id, { minWaitTicks: 3, maxWaitTicks: 4, loadThreshold: 255 });
    expect(setRideOpen(w, id, true)).toBe(true);
    expect(joinRideQueue(w, id, 1)).toBe(true);

    rideSystem.update(w);
    rideSystem.update(w);
    expect(getRidePhase(w, id)).toBe(RidePhase.Waiting);
    rideSystem.update(w);
    expect(getRidePhase(w, id)).toBe(RidePhase.Waiting);
    rideSystem.update(w);
    expect(getRidePhase(w, id)).toBe(RidePhase.Loading);
    expect(getRideBoardedCount(w, id)).toBe(1);
  });

  it('runs a configured loading countdown before the ride cycle', () => {
    const w = world();
    const id = preparedRide(w);
    configureRide(w, id, {
      minWaitTicks: 1,
      maxWaitTicks: 1,
      loadTicks: 2,
      runTicks: 1,
      unloadTicks: 0,
    });
    expect(setRideOpen(w, id, true)).toBe(true);
    expect(joinRideQueue(w, id, 1)).toBe(true);

    rideSystem.update(w);
    expect(getRidePhase(w, id)).toBe(RidePhase.Loading);
    expect(setRideOpen(w, id, true)).toBe(false);
    expect(getRidePhase(w, id)).toBe(RidePhase.Loading);
    rideSystem.update(w);
    expect(getRidePhase(w, id)).toBe(RidePhase.Loading);
    rideSystem.update(w);
    expect(getRidePhase(w, id)).toBe(RidePhase.Running);
    rideSystem.update(w);
    expect(getRidePhase(w, id)).toBe(RidePhase.Waiting);
    expect(getRideGuestsServed(w, id)).toBe(1);
  });

  it('completes running and unloading phases and reports theoretical hourly throughput', () => {
    const w = world();
    const id = preparedRide(w);
    configureRide(w, id, {
      minWaitTicks: 1,
      maxWaitTicks: 1,
      loadTicks: 1,
      runTicks: 2,
      unloadTicks: 1,
    });
    expect(setRideOpen(w, id, true)).toBe(true);
    expect(joinRideQueue(w, id, 2)).toBe(true);

    for (let tick = 0; tick < 5; tick++) rideSystem.update(w);

    expect(getRidePhase(w, id)).toBe(RidePhase.Waiting);
    expect(getRideGuestsServed(w, id)).toBe(2);
    expect(calculateRideThroughputPerHour(2, 80, 20, 140)).toBe(1200);
  });

  it('counts service only after unloading completes', () => {
    const w = world();
    const id = preparedRide(w);
    configureRide(w, id, {
      minWaitTicks: 1,
      maxWaitTicks: 1,
      loadTicks: 1,
      runTicks: 2,
      unloadTicks: 1,
    });
    expect(setRideOpen(w, id, true)).toBe(true);
    expect(joinRideQueue(w, id, 2)).toBe(true);

    rideSystem.update(w);
    expect(getRideGuestsServed(w, id)).toBe(0);
    rideSystem.update(w);
    rideSystem.update(w);
    rideSystem.update(w);
    rideSystem.update(w);
    expect(getRideGuestsServed(w, id)).toBe(2);
  });

  it('finishes an occupied cycle safely when the ride closes or breaks down', () => {
    const w = world();
    const id = preparedRide(w);
    configureRide(w, id, {
      minWaitTicks: 1,
      maxWaitTicks: 1,
      loadTicks: 1,
      runTicks: 2,
      unloadTicks: 1,
    });
    expect(setRideOpen(w, id, true)).toBe(true);
    expect(joinRideQueue(w, id, 2)).toBe(true);
    rideSystem.update(w);
    expect(getRidePhase(w, id)).toBe(RidePhase.Loading);
    rideSystem.update(w);
    expect(getRidePhase(w, id)).toBe(RidePhase.Running);

    expect(setRideOpen(w, id, false)).toBe(true);
    expect(placeRideEntranceExit(w, id, { x: 4, y: 5 }, { x: 5, y: 4 })).toBe(false);
    expect(configureRide(w, id, { runTicks: 5 })).toBe(false);
    expect(
      connectRideQueue(w, id, [
        { x: 4, y: 5 },
        { x: 3, y: 5 },
      ]),
    ).toBe(false);
    rideSystem.update(w);
    rideSystem.update(w);
    rideSystem.update(w);
    expect(getRidePhase(w, id)).toBe(RidePhase.Closed);
    expect(getRideGuestsServed(w, id)).toBe(2);

    expect(setRideOpen(w, id, true)).toBe(true);
    expect(joinRideQueue(w, id, 1)).toBe(true);
    rideSystem.update(w);
    rideSystem.update(w);
    expect(triggerRideBreakdown(w, id)).toBe(true);
    expect(setRideOpen(w, id, false)).toBe(true);
    expect(setRideOpen(w, id, false)).toBe(true);
    rideSystem.update(w);
    rideSystem.update(w);
    rideSystem.update(w);
    expect(getRidePhase(w, id)).toBe(RidePhase.Broken);
    expect(getRideGuestsServed(w, id)).toBe(3);
  });

  it('serves queued guests at food and drink stalls using service capacity', () => {
    const w = world();
    const id = preparedRide(w, RideType.FoodStall);
    configureRide(w, id, {
      minWaitTicks: 1,
      maxWaitTicks: 1,
      loadTicks: 0,
      runTicks: 1,
      unloadTicks: 0,
    });
    expect(setRideOpen(w, id, true)).toBe(true);
    expect(joinRideQueue(w, id, 2)).toBe(true);

    rideSystem.update(w);
    rideSystem.update(w);

    expect(getRideGuestsServed(w, id)).toBeGreaterThan(0);
  });
});

describe('ride ratings, value, and testing hooks', () => {
  it('keeps tested excitement, intensity, and nausea stable while ride age changes its value', () => {
    const w = world();
    const id = preparedRide(w);
    const beforeRatings = getRideRatings(w, id);
    const beforeValue = getRideValueCents(w, id);

    w.tick = 5 * 16_384;
    rideSystem.update(w);

    expect(getRideAgeMonths(w, id)).toBe(5);
    expect(getRideRatings(w, id)).toEqual(beforeRatings);
    expect(getRideValueCents(w, id)).toBeLessThan(beforeValue);
  });

  it('starts a newly placed ride at age zero even when the park is older', () => {
    const w = world();
    w.tick = 5 * 16_384;
    const id = preparedRide(w);

    rideSystem.update(w);

    expect(getRideAgeMonths(w, id)).toBe(0);
  });

  it('adjusts price feedback as value changes with ride age', () => {
    const w = world();
    const id = preparedRide(w);
    setRidePrice(w, id, getRideValueCents(w, id) * 2);
    expect(getRidePriceReaction(w, id)).toBe('fair-value');

    w.tick = 6 * 16_384;
    rideSystem.update(w);

    expect(getRidePriceReaction(w, id)).toBe('too-expensive');
  });

  it('accepts deterministic ride-test measurements through a rides-owned interface', () => {
    const w = world();
    const id = preparedRide(w);

    expect(
      recordRideTestMeasurements(w, id, {
        durationTicks: 480,
        maxSpeed: 820,
        maxPositiveG: 384,
        maxNegativeG: -64,
        maxLateralG: 192,
        dropCount: 3,
        highestDrop: 12,
        inversionCount: 0,
      }),
    ).toBe(true);
    expect(isRideTested(w, id)).toBe(true);
    expect(getRideAgeMonths(w, id)).toBe(0);
    expect(getRideTestMeasurements(w, id)).toEqual({
      durationTicks: 480,
      maxSpeed: 820,
      maxPositiveG: 384,
      maxNegativeG: -64,
      maxLateralG: 192,
      dropCount: 3,
      highestDrop: 12,
      inversionCount: 0,
    });

    expect(
      recordRideTestMeasurements(w, id, {
        durationTicks: -1,
        maxSpeed: 820,
        maxPositiveG: 384,
        maxNegativeG: -64,
        maxLateralG: 192,
        dropCount: 3,
        highestDrop: 12,
        inversionCount: 0,
      }),
    ).toBe(false);
  });
});

describe('ride maintenance and determinism', () => {
  it('lets a mechanic repair a broken ride and reopen it', () => {
    const w = world();
    const id = preparedRide(w);
    expect(setRideOpen(w, id, true)).toBe(true);
    triggerRideBreakdown(w, id);
    expect(getRidePhase(w, id)).toBe(RidePhase.Broken);
    expect(setRideOpen(w, id, false)).toBe(true);
    expect(setRideOpen(w, id, true)).toBe(false);
    expect(getRidePhase(w, id)).toBe(RidePhase.Broken);
    rideSystem.update(w);
    rideSystem.update(w);
    expect(getRideDowntimeTicks(w, id)).toBe(2);
    expect(inspectRide(w, id, 9999)).toBe(false);
    expect(spawnStaff(w, StaffKind.Mechanic)).toBe(true);
    const mechanicId = Array.from(
      { length: w.staff.count },
      (_, slot) => w.staff.slotToId[slot],
    ).find((staffId) => w.staff.cols.kind[w.staff.idToSlot[staffId]] === StaffKind.Mechanic);
    expect(mechanicId).toBeDefined();
    expect(inspectRide(w, id, mechanicId!)).toBe(true);

    expect(getRidePhase(w, id)).toBe(RidePhase.Waiting);
    const downtimeAfterRepair = getRideDowntimeTicks(w, id);
    rideSystem.update(w);
    expect(getRideDowntimeTicks(w, id)).toBe(downtimeAfterRepair);
    expect(isRideInspectionDue(w, id)).toBe(false);
    w.tick += 40 * 60 * 60;
    expect(isRideInspectionDue(w, id)).toBe(true);
  });

  it('keeps a repaired ride closed until a queue is reconnected', () => {
    const w = world();
    const id = preparedRide(w);
    expect(setRideOpen(w, id, true)).toBe(true);
    expect(triggerRideBreakdown(w, id)).toBe(true);
    expect(placeRideEntranceExit(w, id, { x: 4, y: 5 }, { x: 5, y: 4 })).toBe(true);
    expect(spawnStaff(w, StaffKind.Mechanic)).toBe(true);
    const mechanicId = w.staff.slotToId[0];

    expect(inspectRide(w, id, mechanicId)).toBe(true);
    expect(w.rides.cols.state[w.rides.idToSlot[id]]).toBe(0);
    expect(getRidePhase(w, id)).toBe(RidePhase.Closed);
    expect(setRideOpen(w, id, true)).toBe(false);
  });

  it('produces the same ride state hash for equal seeded operation and includes ride state in the hash', () => {
    const a = new Simulation({ seed: 91, width: 16, height: 16 });
    const b = new Simulation({ seed: 91, width: 16, height: 16 });
    const aRide = preparedRide(a.world, RideType.Twist);
    const bRide = preparedRide(b.world, RideType.Twist);
    expect(setRideOpen(a.world, aRide, true)).toBe(true);
    expect(setRideOpen(b.world, bRide, true)).toBe(true);
    expect(joinRideQueue(a.world, aRide, 3)).toBe(true);
    expect(joinRideQueue(b.world, bRide, 3)).toBe(true);
    for (let tick = 0; tick < 20; tick++) {
      a.step();
      b.step();
    }

    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
    setRidePrice(b.world, bRide, getRideValueCents(b.world, bRide) + 1);
    expect(hashWorld(a.world)).not.toBe(hashWorld(b.world));
  });

  it('preserves ride operation state through save and load', () => {
    const w = world();
    const id = preparedRide(w, RideType.FerrisWheel);
    expect(setRideOpen(w, id, true)).toBe(true);
    expect(joinRideQueue(w, id, 5)).toBe(true);
    const simulation = new Simulation({ seed: 0, width: 1, height: 1 });
    Object.assign(simulation, { world: w });
    for (let tick = 0; tick < 3; tick++) simulation.step();

    const loaded = deserialize(serialize(w));

    expect(hashWorld(loaded)).toBe(hashWorld(w));
    expect(getRidePhase(loaded, id)).toBe(getRidePhase(w, id));
  });

  it('migrates version 3 ride columns and allocator state', () => {
    const w = world();
    const id = createRide(w, RideType.MerryGoRound, 4, 4);
    setRidePrice(w, id, 175);
    const loaded = deserialize(preRidesSave(w));
    const slot = loaded.rides.idToSlot[id];

    expect(loaded.rides.count).toBe(1);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(loaded.rides.slotToId[slot]).toBe(id);
    expect(loaded.rides.cols.typeId[slot]).toBe(RideType.MerryGoRound);
    expect(loaded.rides.cols.price[slot]).toBe(175);
    expect(loaded.rides.cols.state[slot]).toBe(0);
    expect(loaded.rides.cols.queueConnected[slot]).toBe(0);
  });
});
