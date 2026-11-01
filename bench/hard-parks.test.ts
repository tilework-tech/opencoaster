import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/core/simulation';
import { ElementType } from '../src/sim/map/tile-map';
import { RideState } from '../src/sim/rides/ride-store';
import { SCENARIOS } from '../src/sim/scenario/catalog';
import { ParkGrid } from '../src/sim/scenario/park-grid';
import { prepareScenarioPark } from '../src/sim/scenario/scenario-layout';
import type { ScenarioDef } from '../src/sim/scenario/scenario';
import { ParkBuilder } from './strategy/builder';
import {
  clearScenery,
  connectOnGround,
  flatGroundPath,
  layRoute,
  openCoaster,
  openFlatRide,
  waypoints,
} from './strategy/site';
import type { CoasterSite } from './strategy/site';

/**
 * Plays the start of each hard park through ordinary player commands with the park's real cash:
 * guests arrive through the gate, the first stalls and rides open, and the park's defining move
 * (a gulch crossing, a pier bridge, a cliff descent, a mountainside coaster, a woodland clearing)
 * is built and used.
 */

interface Park {
  def: ScenarioDef;
  sim: Simulation;
  builder: ParkBuilder;
}

function open(id: string, items: readonly string[]): Park {
  const def = SCENARIOS.find((s) => s.id === id)!;
  const sim = new Simulation({ seed: def.seed, width: def.mapWidth, height: def.mapHeight });
  prepareScenarioPark(sim.world, def);
  const builder = new ParkBuilder(sim, def);
  for (const name of items) expect(builder.build(name), name).toBeGreaterThanOrEqual(0);
  return { def, sim, builder };
}

/** The far end of the spine path the builder laid inward from the gate. */
function spineEnd(park: Park): [number, number] {
  const m = park.sim.world.map;
  let row = 0;
  for (;;) {
    const [x, y] = park.builder.grid.tile(row + 1, 0);
    if (m.pathElement(m.index(x, y), -1) < 0) break;
    row++;
  }
  return park.builder.grid.tile(row, 0);
}

function hasPath(park: Park, [x, y]: readonly [number, number]): boolean {
  const m = park.sim.world.map;
  return m.pathElement(m.index(x, y), -1) >= 0;
}

/** Lays a route from the spine end through `points` and returns its tiles. */
function route(park: Park, points: ReadonlyArray<readonly [number, number]>, clear: boolean) {
  const m = park.sim.world.map;
  const start = spineEnd(park);
  const tiles = waypoints([start, ...points]).slice(1);
  if (clear) clearScenery(park.sim, tiles);
  const levels = layRoute(park.sim, tiles, m.heights[m.index(start[0], start[1])]);
  expect(levels).not.toBeNull();
  for (const tile of tiles) expect(hasPath(park, tile), `path at ${tile}`).toBe(true);
  return { tiles, levels: levels! };
}

function joinsRoute(park: Park, tiles: ReadonlyArray<readonly [number, number]>) {
  const m = park.sim.world.map;
  const set = new Set(tiles.map(([x, y]) => m.index(x, y)));
  return (t: number) => set.has(t) && flatGroundPath(park.sim, t);
}

function play(park: Park, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    park.builder.advance();
    park.sim.step();
  }
}

/** Guests who rode in the ride's recent rider window. */
function riders(park: Park, rideId: number): number {
  const w = park.sim.world;
  const slot = w.rides.idToSlot[rideId];
  const cols = w.rides.cols as unknown as Record<string, ArrayLike<number>>;
  return Object.keys(cols)
    .filter((k) => k.startsWith('ridersWindow'))
    .reduce((sum, k) => sum + cols[k][slot], 0);
}

function trees(park: Park): number {
  const m = park.sim.world.map;
  let n = 0;
  for (let e = 0; e < m.elementCapacity; e++) if (m.elType[e] === ElementType.SmallScenery) n++;
  return n;
}

function expectSolvent(park: Park): void {
  const l = park.sim.world.economy;
  expect(l.cash).toBeGreaterThanOrEqual(0);
  expect(l.loan).toBeLessThanOrEqual(l.maxLoan);
}

const MONTH = 16_384;

describe('hard parks are playable with legal construction', { timeout: 60_000 }, () => {
  it('Copper Ridge: cross the gulch on the trail and open a coaster on the west bench', () => {
    const park = open('copper-ridge', ['foodStall', 'drinkStall', 'toilets', 'merryGoRound']);
    const [x0] = spineEnd(park);
    const trail = route(
      park,
      [
        [x0, 75],
        [34, 75],
        [34, 42],
      ],
      true,
    );
    expect(Math.min(...trail.levels)).toBeLessThanOrEqual(6);
    expect(Math.max(...trail.levels)).toBeGreaterThanOrEqual(11);
    const site: CoasterSite = { template: 'compact', x: 28, y: 40, dir: 0, mirror: true };
    const coaster = openCoaster(park.sim, site, joinsRoute(park, trail.tiles))!;
    expect(coaster.state).toBe(RideState.Open);
    expect(coaster.excitement).toBeGreaterThanOrEqual(park.def.objective.minimumExcitement!);
    play(park, MONTH);
    expect(riders(park, coaster.rideId)).toBeGreaterThan(0);
    expectSolvent(park);
  });

  it('Glacier Point: open stalls and a mountainside coaster above the 4.70 target', () => {
    const park = open('glacier-point', ['foodStall', 'drinkStall', 'toilets']);
    const site: CoasterSite = { template: 'compact', x: 80, y: 56, dir: 2, mirror: false };
    const coaster = openCoaster(park.sim, site, (t) => flatGroundPath(park.sim, t))!;
    expect(coaster).not.toBeNull();
    expect(coaster.state).toBe(RideState.Open);
    expect(coaster.excitement).toBeGreaterThanOrEqual(park.def.objective.minimumExcitement!);
    play(park, MONTH);
    expect(riders(park, coaster.rideId)).toBeGreaterThan(0);
    expectSolvent(park);
  });

  it('Tidewater Docks: buy rights over an inlet, bridge it and fit a ride on a narrow pier', () => {
    const park = open('tidewater-docks', ['foodStall', 'drinkStall', 'toilets', 'merryGoRound']);
    const sim = park.sim;
    const m = sim.world.map;
    const inlet = { x: 37, y: 43, width: 6, height: 3 };
    sim.enqueue({ type: 'buyLand', ...inlet, rights: true });
    sim.step();
    const quay = route(
      park,
      [
        [19, 47],
        [19, 61],
        [34, 61],
        [34, 44],
        [45, 44],
        [45, 52],
      ],
      true,
    );
    const bridge = quay.tiles.filter(([x, y]) => y === 44 && x >= 37 && x <= 42);
    expect(
      bridge.every(
        ([x, y]) =>
          m.waterLevel[m.index(x, y)] > m.heights[m.index(x, y)] || m.slope[m.index(x, y)] !== 0,
      ),
    ).toBe(true);
    expect(bridge.some(([x, y]) => m.waterLevel[m.index(x, y)] > m.heights[m.index(x, y)])).toBe(
      true,
    );
    const pier = new ParkGrid(45, 58, 'south');
    const wheel = openFlatRide(sim, pier, 10, 2, 'ferrisWheel')!;
    expect(wheel).not.toBeNull();
    expect(wheel.state).toBe(RideState.Open);
    play(park, MONTH);
    expect(riders(park, wheel.rideId)).toBeGreaterThan(0);
    expectSolvent(park);
  });

  it('Thunderhead Mesa: take the cliff trail down to the west shelf and open a ride there', () => {
    const park = open('thunderhead-mesa', ['foodStall', 'drinkStall', 'toilets', 'merryGoRound']);
    const [x0] = spineEnd(park);
    const descent: Array<[number, number]> = [
      [x0, 24],
      [34, 24],
    ];
    for (let y = 27; y <= 51; y += 3) descent.push([Math.round(34 - ((y - 24) * 10) / 26), y]);
    descent.push([24, 54]);
    const trail = route(park, descent, true);
    expect(trail.levels[0]).toBe(16);
    expect(trail.levels[trail.levels.length - 1]).toBe(11);
    const shelf = new ParkGrid(24, 51, 'north');
    const ride = openFlatRide(park.sim, shelf, 3, 2, 'drinkStall')!;
    expect(ride).not.toBeNull();
    const pad: Array<[number, number]> = [];
    for (let y = 52; y <= 58; y++) for (let x = 15; x <= 23; x++) pad.push([x, y]);
    clearScenery(park.sim, pad);
    const carousel = openFlatRide(park.sim, shelf, 3, -6, 'merryGoRound');
    expect(carousel?.state ?? -1).toBe(RideState.Open);
    play(park, MONTH);
    expect(riders(park, carousel!.rideId)).toBeGreaterThan(0);
    expectSolvent(park);
  });

  it('Mossgrove Isle: thread a path through the protected woods to a clearing without felling a tree', () => {
    const park = open('mossgrove-isle', ['foodStall', 'drinkStall', 'toilets']);
    const sim = park.sim;
    const m = sim.world.map;
    const before = trees(park);
    const clearing = new ParkGrid(44, 38, 'south');
    const spine = [clearing.tile(1, 0), clearing.tile(2, 0), clearing.tile(3, 0)];
    for (const [x, y] of spine) sim.enqueue({ type: 'placePath', x, y });
    sim.step();
    for (const tile of spine) expect(hasPath(park, tile)).toBe(true);
    const own = new Set(spine.map(([x, y]) => m.index(x, y)));
    const trail = connectOnGround(
      sim,
      clearing.tile(0, 0),
      (t) => !own.has(t) && flatGroundPath(sim, t),
    );
    expect(trail).not.toBeNull();
    expect(trail!.length).toBeGreaterThan(4);
    const carousel = openFlatRide(sim, clearing, 3, 2, 'merryGoRound')!;
    expect(carousel?.state).toBe(RideState.Open);
    play(park, MONTH);
    expect(riders(park, carousel.rideId)).toBeGreaterThan(0);
    expect(trees(park)).toBe(before);
    expectSolvent(park);
  });
});
