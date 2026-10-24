import { applyScenario } from '../sim/scenario/scenario';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/core/simulation';
import { hashWorld } from '../sim/core/hash';
import { PieceId } from '../sim/track/catalog';
import { SAVE_VERSION, deserialize, serialize } from './save';
import { legacyGuestArrays } from '../sim/integration/fixtures';
import { HEADING_NONE } from '../sim/guests/guest-store';
import { flatWorld, guestAt, layPath, row } from '../sim/integration/fixtures';

describe('save', () => {
  it('round-trips world state exactly', () => {
    const sim = new Simulation({ seed: 11, width: 32, height: 32, maxGuests: 500 });
    sim.enqueue({ type: 'spawnGuests', count: 200 });
    for (let i = 0; i < 60; i++) sim.step();
    const loaded = deserialize(serialize(sim.world));
    expect(hashWorld(loaded)).toBe(hashWorld(sim.world));
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

  it('rejects garbage input', () => {
    expect(() => deserialize(new Uint8Array(32))).toThrow();
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
      priceMode: 1,
      admissionPrice: 200,
      availableItemIds: [7],
      inventions: [{ itemId: 8, category: 0, costCents: 10_000 }],
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
    const old = header.replace(`"version":${SAVE_VERSION}`, `"version":2`);
    expect(old).not.toBe(header);
    const patched = new Uint8Array(bytes);
    patched.set(new TextEncoder().encode(old), 8);
    expect(() => deserialize(patched)).toThrow(/Unsupported save version/);
  });
});

describe('save: version 4 migration', () => {
  function versionFourSave(world: ReturnType<typeof flatWorld>): Uint8Array {
    const current = serialize(world);
    const dv = new DataView(current.buffer, current.byteOffset, current.byteLength);
    const headerEnd = 8 + dv.getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(current.subarray(8, headerEnd)));
    header.version = 4;
    delete header.park;
    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const arrays = world.map
      .arrays()
      .concat(
        legacyGuestArrays(world),
        world.staff.arrays(),
        world.vehicles.arrays(),
        world.litter.arrays(),
        world.rides.arrays(),
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
    layPath(world, row(5, 2, 12));
    for (let i = 0; i < 5; i++) guestAt(world, 2 + i, 5);
    world.guests.cols.x[1] += 37;
    world.guests.cols.state[2] = 1;
    world.guests.cols.targetRide[2] = 0;
    const loaded = deserialize(versionFourSave(world));
    expect(loaded.guests.count).toBe(5);
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
});
