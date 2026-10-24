import { applyScenario } from '../sim/scenario/scenario';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/core/simulation';
import { hashWorld } from '../sim/core/hash';
import { PieceId } from '../sim/track/catalog';
import { SAVE_VERSION, deserialize, serialize } from './save';
import { RIDE_COLUMNS_ADDED_IN_V10 } from '../sim/rides/ride-store';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { legacyGuestArrays } from '../sim/integration/fixtures';
import { HEADING_NONE } from '../sim/guests/guest-store';
import type { World } from '../sim/core/world';
import { flatWorld, guestAt, layPath, row } from '../sim/integration/fixtures';
import { StaffKind, spawnStaff } from '../sim/staff/staff-store';
import { dropLitter, LitterKind } from '../sim/guests/litter-store';
import { WeatherKind } from '../sim/weather/weather';

describe('save', () => {
  it('writes the combined guest and ride format as version 12', () => {
    expect(SAVE_VERSION).toBe(12);
    const bytes = serialize(new Simulation({ seed: 1, width: 8, height: 8 }).world);
    const headerLength = new DataView(bytes.buffer).getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength)));
    expect(header.version).toBe(12);
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

describe('save: guest history and satiation migration', () => {
  it.each([8, 9, 10, 11])(
    'migrates version %s guest columns and hunger/thirst scale',
    (version) => {
      const world = flatWorld(16);
      const guest = guestAt(world, 4, 5);
      world.guests.cols.hunger[guest] = 30;
      world.guests.cols.thirst[guest] = 50;
      world.guests.cols.approachGap[guest] = 12;
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
              world.guests.cols.approachGap,
              world.rides.cols.trainCount,
              world.rides.cols.carsPerTrain,
            ]
          : []),
        ...(version <= 10 ? reliabilityColumns(world) : []),
      ];
      const oldSave = withoutColumns(serialize(world), version, views, absent);

      const loaded = deserialize(oldSave);

      expect(loaded.guests.cols.hunger[guest]).toBe(225);
      expect(loaded.guests.cols.thirst[guest]).toBe(205);
      expect(loaded.guests.cols.visitTicks[guest]).toBe(0);
      expect(loaded.guests.cols.ridesTaken[guest]).toBe(0);
      expect(loaded.guests.cols.lastRide[guest]).toBe(-1);
      expect(loaded.guests.cols.approachGap[guest]).toBe(version === 8 ? 0xffff : 12);
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
  return [c.navGoal, c.navGap, c.navSteps, c.lostTicks, c.hasMap];
}

/**
 * Rewrites a current save as `version` would have written it: the header carries that version and
 * the listed columns, which that version did not have, are removed from the body.
 */
function withoutColumns(
  current: Uint8Array,
  version: number,
  views: ArrayBufferView[],
  absent: ArrayBufferView[],
): Uint8Array {
  const dv = new DataView(current.buffer, current.byteOffset, current.byteLength);
  const headerLength = dv.getUint32(4, true);
  const headerEnd = 8 + headerLength;
  const header = JSON.parse(new TextDecoder().decode(current.subarray(8, headerEnd)));
  header.version = version;
  const encoded = new TextEncoder().encode(JSON.stringify(header));
  const body = current.subarray(headerEnd);
  const kept: Uint8Array[] = [];
  let offset = 0;
  for (const view of views) {
    if (!absent.includes(view)) {
      kept.push(body.subarray(offset, offset + view.byteLength));
    }
    offset += view.byteLength;
  }
  const bodyBytes = kept.reduce((n, part) => n + part.byteLength, 0);
  const out = new Uint8Array(8 + encoded.length + bodyBytes);
  out.set(current.subarray(0, 8));
  new DataView(out.buffer).setUint32(4, encoded.length, true);
  out.set(encoded, 8);
  let at = 8 + encoded.length;
  for (const part of kept) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
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
      .concat(
        legacyGuestArrays(world),
        world.staff.arrays(),
        world.vehicles.arrays(),
        world.litter.arrays(),
        world.rides.arrays().slice(0, -3 - RIDE_COLUMNS_ADDED_IN_V10),
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
    expect(loaded.economy.inputs.wageBillPerWeek).toBe(1_154);
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
    expect(loaded.economy.inputs.wageBillPerWeek).toBe(1_154);
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
      world.guests.cols.approachGap,
      ...navigationColumns(world),
      world.rides.cols.trainCount,
      world.rides.cols.carsPerTrain,
      ...reliabilityColumns(world),
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
    world.guests.cols.navGap[guestSlot] = 2;
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
    ]);

    const loaded = deserialize(legacy);

    expect(loaded.guests.cols.navGoal[guestSlot]).toBe(3);
    expect(loaded.guests.cols.navGap[guestSlot]).toBe(2);
    expect(loaded.guests.cols.navSteps[guestSlot]).toBe(7);
    expect(loaded.guests.cols.lostTicks[guestSlot]).toBe(500);
    expect(loaded.guests.cols.hasMap[guestSlot]).toBe(1);
    expect(loaded.research.inventions).toEqual([{ itemId: 8, category: 0, workUnits: 21 }]);
    expect(loaded.rides.cols.reliabilityRaw[rideSlot]).toBe(64 * 256);
    expect(loaded.rides.cols.mode[rideSlot]).toBe(RIDE_CATALOG[RideType.FerrisWheel].modes[0].mode);
    expect(deserialize(serialize(loaded)).rides.cols.reliabilityRaw[rideSlot]).toBe(64 * 256);
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
      world.guests.cols.approachGap,
      ...navigationColumns(world),
      world.rides.cols.incomeCents,
      world.rides.cols.trainCount,
      world.rides.cols.carsPerTrain,
      ...reliabilityColumns(world),
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
