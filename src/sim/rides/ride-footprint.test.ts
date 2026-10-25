import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { World } from '../core/world';
import { ElementType, OWNED, Surface } from '../map/tile-map';
import { applyRideCommand } from './ride-commands';
import { RideResult } from './ride-results';
import { RIDE_CATALOG, RideType } from './ride-types';
import { createRide } from './ride-operations';
import { rideFootprintTiles, rideFootprintContains, validateRidePlacement } from './ride-footprint';

function park(size = 24): World {
  const w = new World({ seed: 5, width: size, height: size });
  w.map.fillFlat(4);
  w.map.ownership.fill(OWNED);
  w.economy.cash = 100_000_000;
  return w;
}

function extent(tiles: ReadonlyArray<readonly [number, number]>): [number, number] {
  const xs = tiles.map(([x]) => x);
  const ys = tiles.map(([, y]) => y);
  return [Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1];
}

const FLAT_FOOTPRINTS: ReadonlyArray<[RideType, number, number]> = [
  [RideType.MerryGoRound, 3, 3],
  [RideType.Twist, 3, 3],
  [RideType.HauntedHouse, 3, 3],
  [RideType.TopSpin, 3, 3],
  [RideType.Enterprise, 4, 4],
  [RideType.SwingingShip, 1, 5],
  [RideType.FerrisWheel, 1, 4],
  [RideType.SpiralSlide, 2, 2],
  [RideType.ObservationTower, 1, 1],
];

describe('flat ride footprints', () => {
  it.each(FLAT_FOOTPRINTS)('type %i covers %i x %i tiles', (type, width, length) => {
    const tiles = rideFootprintTiles(RIDE_CATALOG[type], 10, 10, 0);
    expect(tiles).toHaveLength(width * length);
    expect(extent(tiles)).toEqual([width, length]);
    expect(new Set(tiles.map(([x, y]) => `${x},${y}`)).size).toBe(tiles.length);
    expect(rideFootprintContains(RIDE_CATALOG[type], 10, 10, 0, 10, 10)).toBe(true);
  });

  it('keeps stalls on a single tile', () => {
    expect(rideFootprintTiles(RIDE_CATALOG[RideType.FoodStall], 3, 3, 2)).toEqual([[3, 3]]);
  });

  it('turns a long ride a quarter turn at a time about its anchor tile', () => {
    const def = RIDE_CATALOG[RideType.SwingingShip];
    expect(extent(rideFootprintTiles(def, 10, 10, 0))).toEqual([1, 5]);
    expect(extent(rideFootprintTiles(def, 10, 10, 1))).toEqual([5, 1]);
    expect(extent(rideFootprintTiles(def, 10, 10, 2))).toEqual([1, 5]);
    expect(extent(rideFootprintTiles(def, 10, 10, 3))).toEqual([5, 1]);
    for (let dir = 0; dir < 4; dir++)
      expect(rideFootprintContains(def, 10, 10, dir, 10, 10)).toBe(true);
  });

  it('covers different tiles in the four orientations of an even-sized ride', () => {
    const def = RIDE_CATALOG[RideType.SpiralSlide];
    const sets = [0, 1, 2, 3].map((dir) =>
      rideFootprintTiles(def, 10, 10, dir)
        .map(([x, y]) => `${x},${y}`)
        .sort()
        .join('|'),
    );
    expect(new Set(sets).size).toBe(4);
  });
});

describe('placing a flat ride', () => {
  it('records the orientation and charges once', () => {
    const w = park();
    const sim = new Simulation(w);
    const before = w.economy.cash;
    sim.enqueue({ type: 'createRide', rideType: RideType.SwingingShip, x: 10, y: 10, dir: 1 });
    sim.step();
    expect(w.rides.count).toBe(1);
    expect(w.rides.cols.dir[0]).toBe(1);
    expect(before - w.economy.cash).toBe(RIDE_CATALOG[RideType.SwingingShip].cost);
  });

  it('checks every tile of the footprint for ownership', () => {
    const w = park();
    w.map.ownership[w.map.index(12, 12)] = 0;
    expect(validateRidePlacement(w, RideType.MerryGoRound, 11, 11, 0)).toBe(RideResult.NotOwned);
    expect(validateRidePlacement(w, RideType.MerryGoRound, 10, 10, 0)).toBe(RideResult.Ok);
  });

  it('rejects a footprint that runs off the map', () => {
    const w = park();
    expect(validateRidePlacement(w, RideType.Enterprise, 0, 0, 0)).toBe(RideResult.OutOfBounds);
    expect(validateRidePlacement(w, RideType.SwingingShip, 23, 22, 0)).toBe(RideResult.OutOfBounds);
    expect(validateRidePlacement(w, RideType.SwingingShip, 11, 11, 1)).toBe(RideResult.Ok);
  });

  it('rejects paths and queues on any footprint tile', () => {
    const w = park();
    w.map.surface[w.map.index(9, 9)] = Surface.Path;
    expect(validateRidePlacement(w, RideType.Twist, 10, 10, 0)).toBe(RideResult.Blocked);
    expect(validateRidePlacement(w, RideType.Twist, 11, 11, 0)).toBe(RideResult.Ok);
  });

  it('rejects water under any footprint tile', () => {
    const w = park();
    w.map.waterLevel[w.map.index(11, 9)] = 6;
    w.map.refreshTile(w.map.index(11, 9));
    expect(validateRidePlacement(w, RideType.Twist, 10, 10, 0)).toBe(RideResult.Underwater);
  });

  it('rejects scenery in the footprint', () => {
    const w = park();
    const tile = w.map.index(10, 11);
    w.map.addElement(tile, ElementType.SmallScenery, 4, 6, 0, 0);
    expect(validateRidePlacement(w, RideType.Twist, 10, 10, 0)).toBe(RideResult.Blocked);
  });

  it('rejects overlap with another ride on edge tiles, in any orientation', () => {
    const w = park();
    createRide(w, RideType.MerryGoRound, 10, 10);
    expect(validateRidePlacement(w, RideType.MerryGoRound, 13, 10, 0)).toBe(RideResult.Ok);
    expect(validateRidePlacement(w, RideType.MerryGoRound, 12, 10, 0)).toBe(RideResult.Blocked);
    expect(validateRidePlacement(w, RideType.SwingingShip, 12, 11, 1)).toBe(RideResult.Blocked);
    expect(validateRidePlacement(w, RideType.SwingingShip, 8, 13, 0)).toBe(RideResult.Ok);
  });

  it('accepts a gentle slope and refuses ground steeper than the ride can be supported on', () => {
    const w = park();
    const raise = (x: number, y: number, level: number): void => {
      w.map.vertexHeights[w.map.vertexIndex(x, y)] = level;
      for (const [tx, ty] of [
        [x - 1, y - 1],
        [x, y - 1],
        [x - 1, y],
        [x, y],
      ])
        if (w.map.inBounds(tx, ty)) w.map.refreshTile(w.map.index(tx, ty));
    };
    raise(11, 11, 5);
    expect(validateRidePlacement(w, RideType.MerryGoRound, 10, 10, 0)).toBe(RideResult.Ok);
    raise(10, 10, 12);
    expect(validateRidePlacement(w, RideType.MerryGoRound, 10, 10, 0)).toBe(RideResult.TooSteep);
  });

  it('frees every footprint tile when the ride is removed', () => {
    const w = park();
    const id = createRide(w, RideType.Enterprise, 10, 10);
    expect(validateRidePlacement(w, RideType.Twist, 11, 11, 0)).toBe(RideResult.Blocked);
    w.rides.despawnId(id);
    expect(validateRidePlacement(w, RideType.Twist, 11, 11, 0)).toBe(RideResult.Ok);
  });
});

describe('entrance and exit around a footprint', () => {
  function ridden(): { w: World; id: number } {
    const w = park();
    const id = createRide(w, RideType.MerryGoRound, 10, 10);
    return { w, id };
  }

  it('accepts a boarding tile beside any footprint tile', () => {
    const { w, id } = ridden();
    expect(applyRideCommand(w, { type: 'placeRideEntrance', rideId: id, x: 12, y: 11 })).toBe(
      RideResult.Ok,
    );
    expect(applyRideCommand(w, { type: 'placeRideExit', rideId: id, x: 8, y: 9 })).toBe(
      RideResult.Ok,
    );
  });

  it('refuses tiles inside the footprint, diagonal to it, or further away', () => {
    const { w, id } = ridden();
    const place = (x: number, y: number): RideResult =>
      applyRideCommand(w, { type: 'placeRideEntrance', rideId: id, x, y });
    expect(place(11, 10)).toBe(RideResult.Blocked);
    expect(place(12, 12)).toBe(RideResult.NotAdjacentToStation);
    expect(place(14, 10)).toBe(RideResult.NotAdjacentToStation);
  });

  it('follows the ride orientation', () => {
    const w = park();
    const sim = new Simulation(w);
    sim.enqueue({ type: 'createRide', rideType: RideType.SwingingShip, x: 10, y: 10, dir: 1 });
    sim.step();
    const id = w.rides.slotToId[0];
    const place = (x: number, y: number): RideResult =>
      applyRideCommand(w, { type: 'placeRideEntrance', rideId: id, x, y });
    expect(place(10, 11)).toBe(RideResult.Ok);
    expect(place(10, 8)).toBe(RideResult.NotAdjacentToStation);
    expect(place(12, 10)).toBe(RideResult.Blocked);
    expect(place(13, 10)).toBe(RideResult.Ok);
  });
});
