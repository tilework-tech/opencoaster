import { setParkEntrance } from './park';
import { describe, expect, it } from 'vitest';
import { createGuestSystem } from './guest-system';
import { GuestState } from './guest-store';
import { PathAddition, placePath, removePath, setPathAddition } from '../map/paths';
import { markPathElementBroken } from '../map/tile-map';
import { DIR_DX, DIR_DY } from '../map/tile-map';
import { TILE_UNITS, Z_STEP } from '../core/constants';
import { flatWorld, guestAt, layPath, openRide, row } from '../integration/fixtures';
import { RideType } from '../rides/ride-types';
import { createVandalismSystem } from './vandalism';
import { dropLitter, LitterKind } from './litter-store';
import { setPersonPosition } from '../core/person-position';
import { isPathElementBroken } from '../map/tile-map';
import { hashWorld } from '../core/hash';
import { deserialize, serialize } from '../../save/save';
import type { World } from '../core/world';

const system = createGuestSystem(() => ({ parkRating: 0, entranceFee: 0 }));

function run(w: World, ticks: number, until?: () => boolean): void {
  for (let i = 0; i < ticks; i++) {
    system.update(w);
    w.tick++;
    if (until?.()) return;
  }
}

function tire(w: World, guest: number, energy = 62): void {
  w.guests.cols.energy[guest] = energy;
  w.guests.cols.happiness[guest] = 200;
  w.guests.cols.happinessTarget[guest] = 200;
}

function seated(w: World): number[] {
  const out: number[] = [];
  for (let slot = 0; slot < w.guests.count; slot++)
    if (w.guests.cols.state[slot] === GuestState.Sitting) out.push(slot);
  return out;
}

/** Runs until `guest` is on its seat, so a test starts from a guest that is really seated. */
function seatGuest(w: World, guest: number): void {
  run(w, 3000, () => w.guests.cols.state[guest] === GuestState.Sitting);
  run(w, 150);
  expect(seated(w)).toContain(guest);
}

/** A path with a bench on its middle tile; both open edges of that tile carry two seats. */
function benchStreet(length = 5) {
  const w = flatWorld(16, 9);
  layPath(w, row(6, 4, 4 + length - 1));
  const benchX = 4 + (length >> 1);
  setPathAddition(w.map, benchX, 6, PathAddition.Bench);
  return { w, benchX };
}

/** A T-junction tile with one open edge: exactly two seats. */
function deadEndBench() {
  const w = flatWorld(16, 9);
  layPath(w, row(6, 4, 8));
  layPath(w, [[6, 7]]);
  setPathAddition(w.map, 6, 6, PathAddition.Bench);
  return w;
}

describe('guests resting on benches', () => {
  it('sits a tired guest on a bench it reaches, facing the path from a seat at the open edge', () => {
    const { w, benchX } = benchStreet();
    const guest = guestAt(w, benchX, 6);
    tire(w, guest);

    run(w, 2000, () => seated(w).length > 0);
    run(w, 120);

    expect(seated(w)).toEqual([guest]);
    const c = w.guests.cols;
    const dx = c.x[guest] - (benchX * TILE_UNITS + TILE_UNITS / 2);
    const dy = c.y[guest] - (6 * TILE_UNITS + TILE_UNITS / 2);
    expect(Math.hypot(dx, dy)).toBeGreaterThan(60);
    const facing = c.heading[guest];
    expect(dx * DIR_DX[facing] + dy * DIR_DY[facing]).toBeLessThan(0);
  });

  it('does not seat a rested guest, even one that stands on the bench tile', () => {
    const { w, benchX } = benchStreet();
    const guest = guestAt(w, benchX, 6);
    w.guests.cols.energy[guest] = 120;
    w.guests.cols.nausea[guest] = 0;

    run(w, 3000);

    expect(seated(w)).toEqual([]);
  });

  it('seats a nauseous guest even when its energy is high', () => {
    const { w, benchX } = benchStreet();
    const guest = guestAt(w, benchX, 6);
    w.guests.cols.energy[guest] = 120;
    w.guests.cols.nausea[guest] = 220;

    run(w, 2000, () => seated(w).length > 0);

    expect(seated(w)).toEqual([guest]);
  });

  it('never seats a leaving guest', () => {
    const { w, benchX } = benchStreet();
    const guest = guestAt(w, benchX, 6);
    tire(w, guest);
    w.guests.cols.state[guest] = GuestState.Leaving;

    run(w, 600);

    expect(seated(w)).toEqual([]);
  });

  it('seats at most two guests on one open edge and never on the same spot', () => {
    const w = deadEndBench();
    for (let i = 0; i < 4; i++) tire(w, guestAt(w, 6, 6));

    run(w, 1500, () => seated(w).length === 2);
    run(w, 300);

    const sitting = seated(w);
    expect(sitting.length).toBe(2);
    const c = w.guests.cols;
    expect(
      Math.hypot(c.x[sitting[0]!] - c.x[sitting[1]!], c.y[sitting[0]!] - c.y[sitting[1]!]),
    ).toBeGreaterThan(40);
  });

  it('lets a guest that finds the bench full carry on walking instead of waiting', () => {
    const w = deadEndBench();
    for (let i = 0; i < 3; i++) tire(w, guestAt(w, 6, 6));

    run(w, 1500, () => seated(w).length === 2);
    run(w, 300);

    const states = Array.from({ length: 3 }, (_, g) => w.guests.cols.state[g]);
    expect(states.filter((s) => s === GuestState.Sitting)).toHaveLength(2);
    expect(states.filter((s) => s === GuestState.Wandering)).toHaveLength(1);
  });

  it('restores energy and settles nausea while seated, then sends the guest on its way', () => {
    const { w, benchX } = benchStreet();
    const guest = guestAt(w, benchX, 6);
    tire(w, guest, 60);
    w.guests.cols.nausea[guest] = 200;

    run(w, 2000, () => seated(w).length > 0);
    const energyOnSitting = w.guests.cols.energy[guest];
    const sitStart = w.tick;
    run(w, 6000, () => w.guests.cols.state[guest] !== GuestState.Sitting);

    expect(w.guests.cols.state[guest]).toBe(GuestState.Wandering);
    expect(w.tick - sitStart).toBeGreaterThan(400);
    expect(w.tick - sitStart).toBeLessThan(5000);
    expect(w.guests.cols.energy[guest]).toBeGreaterThan(energyOnSitting + 20);
    expect(w.guests.cols.nausea[guest]).toBeLessThan(120);
  });

  it('does not keep re-sitting a guest straight after it has rested', () => {
    const { w, benchX } = benchStreet();
    const guest = guestAt(w, benchX, 6);
    tire(w, guest, 60);
    seatGuest(w, guest);
    run(w, 6000, () => w.guests.cols.state[guest] !== GuestState.Sitting);
    expect(w.guests.cols.state[guest]).toBe(GuestState.Wandering);

    w.guests.cols.energy[guest] = 60;
    run(w, 200);

    expect(w.guests.cols.state[guest]).toBe(GuestState.Wandering);
  });

  it('walks a tired guest to a reachable bench a few tiles away', () => {
    const w = flatWorld(24, 9);
    layPath(w, row(6, 3, 16));
    setPathAddition(w.map, 14, 6, PathAddition.Bench);
    const guest = guestAt(w, 8, 6);
    tire(w, guest);

    run(w, 4000, () => seated(w).length > 0);

    expect(w.guests.cols.state[guest]).toBe(GuestState.Sitting);
    expect(Math.floor(w.guests.cols.x[guest]! / TILE_UNITS)).toBe(14);
  });

  it('leaves benches beyond reach or on other networks alone', () => {
    const w = flatWorld(40, 9);
    layPath(w, row(6, 3, 8));
    layPath(w, row(12, 3, 20));
    setPathAddition(w.map, 10, 12, PathAddition.Bench);
    const guest = guestAt(w, 4, 6);
    tire(w, guest);

    run(w, 3000);

    expect(w.guests.cols.state[guest]).not.toBe(GuestState.Sitting);
  });
});

describe('resting and the rest of a visit', () => {
  it('sends a rested guest back to the rides instead of keeping it on the bench', () => {
    const w = flatWorld(24, 9);
    layPath(w, row(5, 3, 15));
    setPathAddition(w.map, 5, 5, PathAddition.Bench);
    const ride = openRide(w, RideType.MerryGoRound, [8, 4], [8, 5], [9, 4], [[7, 5]]);
    w.rides.cols.excitement[ride] = 600;
    w.rides.cols.intensity[ride] = 300;
    w.rides.cols.nausea[ride] = 0;
    const guest = guestAt(w, 5, 5);
    tire(w, guest);
    w.guests.cols.preferredIntensity[guest] = 100;
    w.guests.cols.nauseaTolerance[guest] = 255;

    run(w, 2500, () => seated(w).length > 0);
    expect(seated(w)).toEqual([guest]);
    const rideId = w.rides.slotToId[ride];
    const headingForRide = () =>
      w.guests.cols.state[guest] !== GuestState.Sitting &&
      w.guests.cols.targetRide[guest] === rideId;
    run(w, 12000, headingForRide);

    expect(headingForRide()).toBe(true);
  });

  it('finds a bench built after an earlier search came up empty', () => {
    const w = flatWorld(24, 9);
    layPath(w, row(6, 4, 12));
    const guest = guestAt(w, 4, 6);
    tire(w, guest);
    run(w, 200);
    expect(seated(w)).toEqual([]);

    setPathAddition(w.map, 9, 6, PathAddition.Bench);
    run(w, 6000, () => seated(w).length > 0);

    expect(seated(w)).toEqual([guest]);
  });

  it('keeps vandals from breaking a bench someone is sitting on', () => {
    const benchBroken = (withSitter: boolean): boolean => {
      const w = deadEndBench();
      if (withSitter) {
        const sitter = guestAt(w, 6, 6);
        tire(w, sitter);
        seatGuest(w, sitter);
      }
      const vandal = guestAt(w, 6, 6);
      setParkEntrance(w, 4, 6);
      w.guests.cols.happiness[vandal] = 20;
      w.guests.cols.energy[vandal] = 120;
      dropLitter(w, 6, 6, LitterKind.Trash);
      const vandalism = createVandalismSystem();
      for (let i = 0; i < 300; i++) {
        w.tick = i * 32;
        vandalism.update(w);
      }
      return isPathElementBroken(w.map, w.map.pathElement(w.map.index(6, 6), -1));
    };

    expect(benchBroken(false)).toBe(true);
    expect(benchBroken(true)).toBe(false);
  });

  it('frees the seat of a guest the player picks up', () => {
    const w = deadEndBench();
    const first = guestAt(w, 6, 6);
    const second = guestAt(w, 6, 6);
    tire(w, first);
    tire(w, second);
    seatGuest(w, first);
    seatGuest(w, second);
    const third = guestAt(w, 6, 6);
    tire(w, third);
    run(w, 300);
    expect(w.guests.cols.state[third]).toBe(GuestState.Wandering);

    w.guests.cols.energy[first] = 120;
    expect(setPersonPosition(w, 'guest', w.guests.slotToId[first]!, 5, 6)).toBe(true);
    w.guests.cols.restCooldown[third] = 0;
    run(w, 1500, () => w.guests.cols.state[third] === GuestState.Sitting);

    expect(w.guests.cols.state[first]).toBe(GuestState.Wandering);
    expect(w.guests.cols.state[third]).toBe(GuestState.Sitting);
  });
});

describe('benches under a bridge', () => {
  const GROUND = 4;
  const BRIDGE = 6;

  function bridgeOverBench() {
    const w = flatWorld(24, 9);
    layPath(w, row(10, 2, 16));
    layPath(w, [[9, 5]]);
    const pieces: Array<[number, number, number, number]> = [
      [9, 6, GROUND, 1],
      [9, 7, GROUND + 1, 1],
      [9, 8, BRIDGE, -1],
      [9, 9, BRIDGE, -1],
      [9, 10, BRIDGE, -1],
      [9, 11, BRIDGE, -1],
      [9, 12, BRIDGE, -1],
      [9, 13, GROUND + 1, 3],
      [9, 14, GROUND, 3],
    ];
    for (const [x, y, z, slope] of pieces)
      if (!placePath(w.map, { x, y, z, slope })) throw new Error(`bridge piece ${x},${y}`);
    setPathAddition(w.map, 9, 10, PathAddition.Bench);
    return w;
  }

  it('seats a tired guest on the path under the bridge but not one walking over it', () => {
    const w = bridgeOverBench();
    const below = guestAt(w, 9, 10);
    const above = guestAt(w, 9, 10);
    tire(w, below);
    tire(w, above);
    w.guests.cols.z[above] = BRIDGE * Z_STEP;

    run(w, 600);

    expect(w.guests.cols.state[below]).toBe(GuestState.Sitting);
    expect(w.guests.cols.state[above]).not.toBe(GuestState.Sitting);
  });
});

describe('bench condition and removal', () => {
  it('ignores a broken bench', () => {
    const { w, benchX } = benchStreet();
    const element = w.map.pathElement(w.map.index(benchX, 6), -1);
    markPathElementBroken(w.map, element);
    const guest = guestAt(w, benchX, 6);
    tire(w, guest);

    run(w, 3000);

    expect(seated(w)).toEqual([]);
  });

  it('stands a seated guest up when the bench is vandalised', () => {
    const { w, benchX } = benchStreet();
    const guest = guestAt(w, benchX, 6);
    tire(w, guest);
    seatGuest(w, guest);
    markPathElementBroken(w.map, w.map.pathElement(w.map.index(benchX, 6), -1));

    run(w, 200);

    expect(w.guests.cols.state[guest]).toBe(GuestState.Wandering);
  });

  it('stands a seated guest up when the bench is removed, and frees the seat', () => {
    const w = deadEndBench();
    const first = guestAt(w, 6, 6);
    tire(w, first);
    seatGuest(w, first);
    setPathAddition(w.map, 6, 6, PathAddition.None);

    run(w, 200);

    expect(w.guests.cols.state[first]).toBe(GuestState.Wandering);
    setPathAddition(w.map, 6, 6, PathAddition.Bench);
    const second = guestAt(w, 6, 6);
    tire(w, second);
    run(w, 1500, () => seated(w).length > 0);
    expect(seated(w)).toEqual([second]);
  });

  it('stands a seated guest up when the path under the bench is removed', () => {
    const w = deadEndBench();
    const guest = guestAt(w, 6, 6);
    tire(w, guest);
    seatGuest(w, guest);
    removePath(w.map, { x: 6, y: 6 });

    run(w, 400);

    expect(w.guests.cols.state[guest]).not.toBe(GuestState.Sitting);
  });

  it('stands a seated guest up when a path is built over the open edge', () => {
    const w = deadEndBench();
    const guest = guestAt(w, 6, 6);
    tire(w, guest);
    seatGuest(w, guest);
    layPath(w, [[6, 5]]);

    run(w, 200);

    expect(w.guests.cols.state[guest]).toBe(GuestState.Wandering);
  });
});

describe('seats across save and load', () => {
  it('keeps a seated guest seated and its seat taken after a round trip', () => {
    const w = deadEndBench();
    const first = guestAt(w, 6, 6);
    tire(w, first);
    run(w, 1500, () => seated(w).length > 0);
    run(w, 100);

    const restored = deserialize(serialize(w));

    expect(hashWorld(restored)).toBe(hashWorld(w));
    expect(seated(restored)).toEqual([first]);
    for (let i = 0; i < 3; i++) tire(restored, guestAt(restored, 6, 6));
    run(restored, 1500, () => seated(restored).length === 2);
    run(restored, 300);
    expect(seated(restored)).toHaveLength(2);
    run(restored, 6000, () => restored.guests.cols.state[first] !== GuestState.Sitting);
    expect(restored.guests.cols.state[first]).toBe(GuestState.Wandering);
  });

  it('replays resting deterministically', () => {
    const make = () => {
      const { w, benchX } = benchStreet();
      for (let i = 0; i < 5; i++) tire(w, guestAt(w, benchX, 6), 56 + i);
      let mostSeated = 0;
      run(w, 3000, () => {
        mostSeated = Math.max(mostSeated, seated(w).length);
        return false;
      });
      expect(mostSeated).toBeGreaterThan(1);
      return hashWorld(w);
    };
    expect(make()).toBe(make());
  });
});
