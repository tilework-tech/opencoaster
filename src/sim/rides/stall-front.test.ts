import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import type { Command } from '../core/commands';
import { FeedbackDomain } from '../core/feedback';
import { flatWorld, guestAt } from '../integration/fixtures';
import { DIR_DX, DIR_DY } from '../map/tile-map';
import { RideType } from './ride-types';
import { RideResult } from './ride-results';
import { RideState } from './ride-store';
import { stallFrontProblem } from './stall-front';

const STALL: readonly [number, number] = [10, 10];

function park(): Simulation {
  const sim = new Simulation(flatWorld(24));
  sim.world.economy.cash = 10_000_000;
  for (const type of [RideType.FoodStall, RideType.DrinkStall, RideType.Toilets])
    sim.world.research.unlocked.add(type);
  return sim;
}

/** Applies one command and returns the ride feedback code it produced. */
function command(sim: Simulation, c: Command): number {
  const seq = sim.world.feedback.seq;
  sim.enqueue(c);
  sim.applyPendingCommands();
  return sim.world.feedback.seq === seq ? -1 : sim.world.feedback.code;
}

function buildStall(
  sim: Simulation,
  dir: number,
  at = STALL,
  rideType = RideType.FoodStall,
): number {
  expect(command(sim, { type: 'createRide', rideType, x: at[0], y: at[1], dir })).toBe(
    RideResult.Ok,
  );
  expect(sim.world.feedback.domain).toBe(FeedbackDomain.Ride);
  return sim.world.feedback.subject;
}

/** Tile `steps` tiles from the stall along `dir`. */
function along(dir: number, steps: number, at = STALL): [number, number] {
  return [at[0] + DIR_DX[dir]! * steps, at[1] + DIR_DY[dir]! * steps];
}

/** A straight footpath leading away from the stall's `dir` side, starting on the adjoining tile. */
function pathAway(sim: Simulation, dir: number, length = 6, at = STALL): void {
  for (let step = 1; step <= length; step++) {
    const [x, y] = along(dir, step, at);
    path(sim, x, y);
  }
}

/** Lays one footpath piece and checks the tile gained it. */
function path(
  sim: Simulation,
  x: number,
  y: number,
  extra: { z?: number; slope?: number; queue?: boolean } = {},
): void {
  const map = sim.world.map;
  const tile = map.index(x, y);
  const pieces = (): number => {
    let count = 0;
    for (let e = map.firstElement(tile); e >= 0; e = map.nextElement(e))
      if (map.pathElement(tile, map.elBase[e]!) === e) count++;
    return count;
  };
  const before = pieces();
  command(sim, { type: 'placePath', x, y, ...extra });
  expect(pieces(), `footpath at ${x}, ${y}`).toBe(before + 1);
}

/** Puts a hungry guest at the far end of the path on the stall's `dir` side and runs until served. */
function servesHungryGuest(
  sim: Simulation,
  rideId: number,
  dir: number,
  ticks = 4000,
  need: 'hunger' | 'thirst' = 'hunger',
): boolean {
  const w = sim.world;
  const slot = w.rides.idToSlot[rideId]!;
  const [gx, gy] = along(dir, 6);
  // guestAt also moves the park gate onto the guest's tile, which keeps the guest in the park.
  const guest = guestAt(w, gx, gy);
  w.guests.cols.hunger[guest] = need === 'hunger' ? 5 : 250;
  w.guests.cols.thirst[guest] = need === 'thirst' ? 5 : 250;
  w.guests.cols.toilet[guest] = 0;
  const before = w.rides.cols.guestsServed[slot]!;
  for (let tick = 0; tick < ticks && w.rides.cols.guestsServed[slot] === before; tick++) sim.step();
  return w.rides.cols.guestsServed[slot]! > before;
}

describe('stall storefronts', () => {
  it.each([0, 1, 2, 3])('serves guests from a front facing %i built after the path', (dir) => {
    const sim = park();
    pathAway(sim, dir);
    const rideId = buildStall(sim, dir);

    expect(sim.world.rides.cols.state[sim.world.rides.idToSlot[rideId]!]).toBe(RideState.Open);
    expect(stallFrontProblem(sim.world, rideId)).toBe(RideResult.Ok);
    expect(servesHungryGuest(sim, rideId, dir)).toBe(true);
  });

  it.each([0, 1, 2, 3])('serves guests once a path is built to a front facing %i', (dir) => {
    const sim = park();
    const rideId = buildStall(sim, dir);
    expect(sim.world.rides.cols.state[sim.world.rides.idToSlot[rideId]!]).toBe(RideState.Open);
    expect(stallFrontProblem(sim.world, rideId)).toBe(RideResult.StallNoPath);

    pathAway(sim, dir);

    expect(stallFrontProblem(sim.world, rideId)).toBe(RideResult.Ok);
    expect(servesHungryGuest(sim, rideId, dir)).toBe(true);
  });

  it.each([0, 1, 2, 3])('does not serve from the sides or back of a stall facing %i', (dir) => {
    const sim = park();
    for (const side of [1, 2, 3]) pathAway(sim, (dir + side) & 3);
    const rideId = buildStall(sim, dir);

    expect(stallFrontProblem(sim.world, rideId)).toBe(RideResult.StallNoPath);
    expect(servesHungryGuest(sim, rideId, (dir + 2) & 3, 1500)).toBe(false);

    pathAway(sim, dir);
    expect(servesHungryGuest(sim, rideId, dir, 1500)).toBe(true);
  });

  it('lets two stalls face the same path tile and serve from it', () => {
    const sim = park();
    pathAway(sim, 0);
    const first = buildStall(sim, 0);
    const shared = along(0, 1);
    const second = buildStall(sim, 3, [shared[0], shared[1] + 1], RideType.DrinkStall);

    expect(stallFrontProblem(sim.world, first)).toBe(RideResult.Ok);
    expect(stallFrontProblem(sim.world, second)).toBe(RideResult.Ok);
    expect(servesHungryGuest(sim, first, 0)).toBe(true);
    expect(servesHungryGuest(sim, second, 0, 4000, 'thirst')).toBe(true);
  });

  it('stops serving while the front path is removed and serves again when it is rebuilt', () => {
    const sim = park();
    pathAway(sim, 1);
    const rideId = buildStall(sim, 1);
    const [fx, fy] = along(1, 1);

    command(sim, { type: 'removePath', x: fx, y: fy });
    expect(stallFrontProblem(sim.world, rideId)).toBe(RideResult.StallNoPath);
    expect(servesHungryGuest(sim, rideId, 1, 1500)).toBe(false);

    command(sim, { type: 'placePath', x: fx, y: fy });
    expect(stallFrontProblem(sim.world, rideId)).toBe(RideResult.Ok);
    expect(servesHungryGuest(sim, rideId, 1)).toBe(true);
  });

  it('keeps a stall facing its own front when a path appears on another side', () => {
    const sim = park();
    pathAway(sim, 2);
    const rideId = buildStall(sim, 2);
    pathAway(sim, 0);

    expect(servesHungryGuest(sim, rideId, 0, 1500)).toBe(false);
    expect(servesHungryGuest(sim, rideId, 2)).toBe(true);
  });

  it('explains a queue line in front of the stall', () => {
    const sim = park();
    const [fx, fy] = along(0, 1);
    path(sim, fx, fy, { queue: true });
    const rideId = buildStall(sim, 0);
    expect(stallFrontProblem(sim.world, rideId)).toBe(RideResult.StallQueue);
  });

  it('explains a raised footpath that passes the front above the stall', () => {
    const sim = park();
    const [fx, fy] = along(0, 1);
    path(sim, fx, fy, { z: 7 });
    const rideId = buildStall(sim, 0);
    expect(stallFrontProblem(sim.world, rideId)).toBe(RideResult.StallHeight);
  });

  it('serves from the ground path when a bridge also crosses the front tile', () => {
    const sim = park();
    pathAway(sim, 0);
    const [fx, fy] = along(0, 1);
    path(sim, fx, fy, { z: 8 });
    const rideId = buildStall(sim, 0);

    expect(stallFrontProblem(sim.world, rideId)).toBe(RideResult.Ok);
    expect(servesHungryGuest(sim, rideId, 0)).toBe(true);
  });

  /** Raises the stall tile one level so its floor sits above the flat ground around it. */
  function raisedStallPark(): Simulation {
    const sim = park();
    const map = sim.world.map;
    const [sx, sy] = STALL;
    for (const [vx, vy] of [
      [sx, sy],
      [sx + 1, sy],
      [sx, sy + 1],
      [sx + 1, sy + 1],
    ])
      map.vertexHeights[vy! * (map.width + 1) + vx!] = 5;
    for (let y = sy - 1; y <= sy + 1; y++)
      for (let x = sx - 1; x <= sx + 1; x++) map.refreshTile(map.index(x, y));
    return sim;
  }

  it.each([0, 1, 2, 3])(
    'connects a ramp on side %i that rises to the raised stall floor',
    (dir) => {
      const sim = raisedStallPark();
      const [fx, fy] = along(dir, 1);
      const towardStall = (dir + 2) & 3;
      path(sim, fx, fy, { z: 4, slope: towardStall });
      const rideId = buildStall(sim, dir);
      expect(stallFrontProblem(sim.world, rideId)).toBe(RideResult.Ok);
    },
  );

  it('explains a ramp that runs across the stall front', () => {
    const sim = park();
    const [fx, fy] = along(0, 1);
    const acrossFront = 1;
    path(sim, fx, fy, { z: 4, slope: acrossFront });
    const rideId = buildStall(sim, 0);
    expect(stallFrontProblem(sim.world, rideId)).toBe(RideResult.StallSlope);
  });

  it('explains a stall on a slope whose floor sits a level above the flat path in front', () => {
    const sim = park();
    const map = sim.world.map;
    const [sx, sy] = STALL;
    for (const vy of [sy, sy + 1]) map.vertexHeights[vy * (map.width + 1) + sx] = 5;
    for (let y = sy - 1; y <= sy + 1; y++)
      for (let x = sx - 1; x <= sx + 1; x++) map.refreshTile(map.index(x, y));
    const [fx, fy] = along(0, 1);
    path(sim, fx, fy);
    const rideId = buildStall(sim, 0);
    expect(stallFrontProblem(sim.world, rideId)).toBe(RideResult.StallHeight);
  });

  it('explains a front tile outside the land the park owns', () => {
    const sim = park();
    const [fx, fy] = along(3, 1);
    path(sim, fx, fy);
    sim.world.map.ownership[sim.world.map.index(fx, fy)] = 0;
    const rideId = buildStall(sim, 3);
    expect(stallFrontProblem(sim.world, rideId)).toBe(RideResult.NotOwned);
  });

  it('turns a stall to face an adjacent path when its entrance is placed there', () => {
    const sim = park();
    pathAway(sim, 1);
    const rideId = buildStall(sim, 3);
    const [fx, fy] = along(1, 1);

    expect(command(sim, { type: 'placeRideEntrance', rideId, x: fx, y: fy })).toBe(RideResult.Ok);
    expect(sim.world.rides.cols.dir[sim.world.rides.idToSlot[rideId]!]).toBe(1);
    expect(servesHungryGuest(sim, rideId, 1)).toBe(true);
  });

  it('refuses to turn a stall toward a tile without a usable path and keeps its facing', () => {
    const sim = park();
    const rideId = buildStall(sim, 3);
    const [fx, fy] = along(1, 1);

    expect(command(sim, { type: 'placeRideEntrance', rideId, x: fx, y: fy })).toBe(
      RideResult.StallNoPath,
    );
    expect(sim.world.rides.cols.dir[sim.world.rides.idToSlot[rideId]!]).toBe(3);
  });

  it('explains why a stall cannot turn toward a queue line', () => {
    const sim = park();
    const rideId = buildStall(sim, 3);
    const [fx, fy] = along(1, 1);
    path(sim, fx, fy, { queue: true });
    expect(command(sim, { type: 'placeRideEntrance', rideId, x: fx, y: fy })).toBe(
      RideResult.StallQueue,
    );
  });

  it('refuses an entrance tile that does not touch the stall', () => {
    const sim = park();
    const rideId = buildStall(sim, 3);
    const [x, y] = along(1, 2);
    path(sim, x, y);
    expect(command(sim, { type: 'placeRideEntrance', rideId, x, y })).toBe(
      RideResult.NotAdjacentToStation,
    );
  });

  it('explains a stall on the map edge whose front faces off the map', () => {
    const sim = park();
    const rideId = buildStall(sim, 3, [5, 0]);
    expect(stallFrontProblem(sim.world, rideId)).toBe(RideResult.OutOfBounds);
  });

  it('serves toilets from their front like any stall', () => {
    const sim = park();
    pathAway(sim, 2);
    const rideId = buildStall(sim, 2, STALL, RideType.Toilets);
    const w = sim.world;
    const slot = w.rides.idToSlot[rideId]!;
    const [gx, gy] = along(2, 6);
    const guest = guestAt(w, gx, gy);
    w.guests.cols.toilet[guest] = 250;
    w.guests.cols.hunger[guest] = 250;
    w.guests.cols.thirst[guest] = 250;
    for (let tick = 0; tick < 4000 && w.rides.cols.guestsServed[slot] === 0; tick++) sim.step();
    expect(w.rides.cols.guestsServed[slot]).toBeGreaterThan(0);
  });

  it('lets guests walking to a stall give up when its front path is removed', () => {
    const sim = park();
    pathAway(sim, 0, 10);
    const rideId = buildStall(sim, 0);
    const w = sim.world;
    const [gx, gy] = along(0, 10);
    const guest = guestAt(w, gx, gy);
    w.guests.cols.hunger[guest] = 5;
    for (let tick = 0; tick < 200 && w.guests.cols.targetRide[guest] !== rideId; tick++) sim.step();
    expect(w.guests.cols.targetRide[guest]).toBe(rideId);
    const [fx, fy] = along(0, 1);
    command(sim, { type: 'removePath', x: fx, y: fy });
    for (let tick = 0; tick < 1500; tick++) sim.step();
    expect(w.rides.cols.guestsServed[w.rides.idToSlot[rideId]!]).toBe(0);
    expect(w.guests.cols.targetRide[guest]).not.toBe(rideId);
  });

  it('stays closed after the player closes it, even when its path is rebuilt', () => {
    const sim = park();
    pathAway(sim, 0);
    const rideId = buildStall(sim, 0);
    command(sim, { type: 'setRideStatus', rideId, status: 'close' });
    const [fx, fy] = along(0, 1);
    command(sim, { type: 'removePath', x: fx, y: fy });
    command(sim, { type: 'placePath', x: fx, y: fy });

    expect(sim.world.rides.cols.state[sim.world.rides.idToSlot[rideId]!]).toBe(RideState.Closed);
  });
});
