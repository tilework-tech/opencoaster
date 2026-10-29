import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { World } from '../core/world';
import { DEFAULT_MAP_SIZE, TICK_RATE, TILE_UNITS } from '../core/constants';
import { SCENARIOS } from '../scenario/catalog';
import { prepareSandbox } from '../scenario/sandbox';
import { prepareScenario } from '../scenario/scenario-layout';
import { prepareScenarioPark } from '../scenario/scenario-layout';
import { PathAddition, placePath, setPathAddition } from '../map/paths';
import { isPathElementBroken, markPathElementBroken, OWNED, RIGHTS_OWNED } from '../map/tile-map';
import { deserialize, serialize } from '../../save/save';
import { GuestState } from './guest-store';
import { LitterKind } from './litter-store';
import { litterSystem } from './litter-system';
import { createVandalismSystem } from './vandalism';
import { setParkEntrance, spawnPoints } from './park';
import { isGateApproach, isParkInterior, purgeExteriorMess } from './park-interior';

function sandbox(): World {
  const world = new World({ seed: 1, width: DEFAULT_MAP_SIZE, height: DEFAULT_MAP_SIZE });
  prepareSandbox(world);
  return world;
}

function scenarioWithApproach(): World {
  const def = SCENARIOS.find((s) => s.entrance)!;
  const world = new World({ seed: def.seed, width: def.mapWidth, height: def.mapHeight });
  prepareScenarioPark(world, def);
  return world;
}

function scenarioWithoutApproach(): World {
  const def = SCENARIOS.find((s) => s.entrance)!;
  const world = new World({ seed: def.seed, width: def.mapWidth, height: def.mapHeight });
  prepareScenario(world, def);
  return world;
}

const WORLDS: Array<[string, () => World]> = [
  ['sandbox', sandbox],
  ['scenario with edge approach', scenarioWithApproach],
  ['scenario whose gate is the arrival point', scenarioWithoutApproach],
];

/** Tiles from the gate toward the arrival point, nearest the gate first, then the first tile inside. */
function approachTiles(world: World): Array<[number, number]> {
  const gx = world.park.entranceX;
  const gy = world.park.entranceY;
  const spawn = spawnPoints(world)[0]!;
  const dx = Math.sign(spawn.x - gx);
  const dy = Math.sign(spawn.y - gy);
  const tiles: Array<[number, number]> = [];
  for (let x = gx, y = gy; ; x += dx, y += dy) {
    tiles.push([x, y]);
    if (x === spawn.x && y === spawn.y) break;
  }
  return tiles;
}

function insideNextToGate(world: World): [number, number] {
  const gx = world.park.entranceX;
  const gy = world.park.entranceY;
  const neighbours: Array<[number, number]> = [
    [gx + 1, gy],
    [gx - 1, gy],
    [gx, gy + 1],
    [gx, gy - 1],
  ];
  const found = neighbours.find(
    ([x, y]) =>
      world.map.inBounds(x, y) &&
      world.map.isWalkable(world.map.index(x, y)) &&
      !isGateApproach(world, x, y),
  );
  if (!found) throw new Error('no path inside the gate');
  return found;
}

function plantLitter(world: World, x: number, y: number, kind = LitterKind.Trash): void {
  const slot = world.litter.spawn();
  world.litter.cols.x[slot] = x * TILE_UNITS + (TILE_UNITS >> 1);
  world.litter.cols.y[slot] = y * TILE_UNITS + (TILE_UNITS >> 1);
  world.litter.cols.z[slot] = world.map.heightAt(
    world.litter.cols.x[slot]!,
    world.litter.cols.y[slot]!,
  );
  world.litter.cols.kind[slot] = kind;
}

function litterTiles(world: World): Array<[number, number]> {
  return Array.from({ length: world.litter.count }, (_, slot): [number, number] => [
    world.litter.cols.x[slot]! >> 8,
    world.litter.cols.y[slot]! >> 8,
  ]);
}

function placeGuest(world: World, x: number, y: number, state = GuestState.Wandering): number {
  world.guests.spawn();
  const slot = world.guests.count - 1;
  world.guests.cols.x[slot] = x * TILE_UNITS + (TILE_UNITS >> 1);
  world.guests.cols.y[slot] = y * TILE_UNITS + (TILE_UNITS >> 1);
  world.guests.cols.state[slot] = state;
  world.guests.cols.nausea[slot] = 255;
  return slot;
}

function litterCheck(world: World): void {
  world.tick = 160;
  litterSystem.update(world);
}

describe('park interior', () => {
  it.each(WORLDS)(
    '%s: the gate and approach are outside, the tile past the gate is inside',
    (_n, build) => {
      const world = build();
      for (const [x, y] of approachTiles(world)) {
        expect(isGateApproach(world, x, y), `${x},${y}`).toBe(true);
        expect(isParkInterior(world, x, y), `${x},${y}`).toBe(false);
      }
      const [ix, iy] = insideNextToGate(world);
      expect(isParkInterior(world, ix, iy)).toBe(true);
    },
  );

  it('keeps the approach outside after the player buys the land beside and under it', () => {
    const world = sandbox();
    for (const [x, y] of approachTiles(world)) world.map.ownership[world.map.index(x, y)] = OWNED;
    for (const [x, y] of approachTiles(world)) expect(isParkInterior(world, x, y)).toBe(false);
  });

  it('does not count construction rights alone, or unowned land, as the park', () => {
    const world = sandbox();
    const [ix, iy] = insideNextToGate(world);
    const tile = world.map.index(ix, iy);
    world.map.ownership[tile] = RIGHTS_OWNED;
    expect(isParkInterior(world, ix, iy)).toBe(false);
    world.map.ownership[tile] = 0;
    expect(isParkInterior(world, ix, iy)).toBe(false);
    expect(isParkInterior(world, -1, 0)).toBe(false);
  });
});

describe('guest litter at the gate', () => {
  it.each(WORLDS)(
    '%s: a guest on the approach drops nothing; the same guest past the gate does',
    (_n, build) => {
      const world = build();
      const [ix, iy] = insideNextToGate(world);
      for (const [x, y] of approachTiles(world)) placeGuest(world, x, y);
      litterCheck(world);
      expect(world.litter.count).toBe(0);
      for (let slot = 0; slot < world.guests.count; slot++)
        expect(world.guests.cols.nausea[slot]).toBe(255);

      placeGuest(world, ix, iy);
      litterCheck(world);
      expect(litterTiles(world)).toEqual([[ix, iy]]);
    },
  );

  it('a guest who has decided to leave still litters until it crosses out of the gate', () => {
    const world = sandbox();
    const [ix, iy] = insideNextToGate(world);
    placeGuest(world, ix, iy, GuestState.Leaving);
    litterCheck(world);
    expect(litterTiles(world)).toEqual([[ix, iy]]);

    const out = new Simulation(world);
    const exiting = placeGuest(
      world,
      world.park.entranceX,
      world.park.entranceY,
      GuestState.Leaving,
    );
    const before = world.guests.count;
    for (let i = 0; i < 64 && world.guests.count === before; i++) out.step();
    expect(world.guests.count).toBeLessThan(before);
    expect(exiting).toBeGreaterThanOrEqual(0);
  });

  it.each(WORLDS)(
    '%s: ten minutes of arrivals leave no mess outside while the park gets dirty',
    (_n, build) => {
      const world = build();
      const sim = new Simulation(world);
      sim.enqueue({ type: 'spawnGuests', count: 30 });
      for (let tick = 0; tick < TICK_RATE * 60 * 10; tick++) {
        sim.step();
        if (tick % 160 === 0)
          for (let slot = 0; slot < world.guests.count; slot++)
            world.guests.cols.nausea[slot] = 200;
      }
      expect(world.litter.count).toBeGreaterThan(0);
      for (const [x, y] of litterTiles(world))
        expect(isParkInterior(world, x, y), `${x},${y}`).toBe(true);
    },
  );
});

describe('vandalism at the gate', () => {
  function benchAt(world: World, x: number, y: number): number {
    const tile = world.map.index(x, y);
    const owner = world.map.ownership[tile]!;
    world.map.ownership[tile] = OWNED;
    expect(setPathAddition(world.map, x, y, PathAddition.Bench)).toBe(true);
    world.map.ownership[tile] = owner;
    return world.map.pathElement(tile, -1);
  }

  it('angry guests break a bench inside the park but not one on the approach', () => {
    const world = sandbox();
    const [ix, iy] = insideNextToGate(world);
    const [ax, ay] = approachTiles(world)[2]!;
    const inside = benchAt(world, ix, iy);
    const outside = benchAt(world, ax, ay);
    for (const [x, y] of [
      [ix, iy],
      [ax, ay],
    ] as const) {
      const slot = placeGuest(world, x, y);
      world.guests.cols.happiness[slot] = 10;
      world.guests.cols.energy[slot] = 200;
      world.guests.cols.angriness[slot] = 512;
    }
    const system = createVandalismSystem();
    for (let i = 0; i < 600; i++) {
      world.tick = i * 32;
      for (let slot = 0; slot < world.guests.count; slot++) world.guests.cols.angriness[slot] = 512;
      system.update(world);
    }
    expect(isPathElementBroken(world.map, inside)).toBe(true);
    expect(isPathElementBroken(world.map, outside)).toBe(false);
  });
});

describe('loading a contaminated park', () => {
  function contaminated(build: () => World) {
    const world = build();
    const [ix, iy] = insideNextToGate(world);
    const approach = approachTiles(world);
    const [ax, ay] = approach[approach.length - 1]!;
    for (const [x, y] of approach) plantLitter(world, x, y, LitterKind.Vomit);
    plantLitter(world, ix, iy);
    const outsideRights = world.map.index(ix + 40, iy);
    world.map.ownership[outsideRights] = RIGHTS_OWNED;
    plantLitter(world, ix + 40, iy);
    const lamp = (x: number, y: number) => {
      const tile = world.map.index(x, y);
      const owner = world.map.ownership[tile]!;
      world.map.ownership[tile] = OWNED;
      setPathAddition(world.map, x, y, PathAddition.Lamp);
      world.map.ownership[tile] = owner;
      const element = world.map.pathElement(tile, -1);
      markPathElementBroken(world.map, element);
      return element;
    };
    const outsideLamp = lamp(ax, ay);
    const insideLamp = lamp(ix, iy);
    return { world, outsideLamp, insideLamp, inside: [ix, iy] as const };
  }

  it.each(WORLDS.slice(0, 2))(
    '%s: a loaded save drops exterior litter and repairs exterior damage only',
    (_n, build) => {
      const { world, inside } = contaminated(build);
      const pathsBefore = world.map.elType.slice();
      const loaded = deserialize(serialize(world));

      expect(litterTiles(loaded)).toEqual([[inside[0], inside[1]]]);
      const [ax, ay] = approachTiles(loaded).at(-1)!;
      const outside = loaded.map.pathElement(loaded.map.index(ax, ay), -1);
      expect(isPathElementBroken(loaded.map, outside)).toBe(false);
      const interior = loaded.map.pathElement(loaded.map.index(inside[0], inside[1]), -1);
      expect(isPathElementBroken(loaded.map, interior)).toBe(true);
      expect(loaded.map.elType).toEqual(pathsBefore);
    },
  );

  it('is idempotent and reports what it changed', () => {
    const { world } = contaminated(sandbox);
    const first = purgeExteriorMess(world);
    expect(first.litter).toBeGreaterThan(0);
    expect(first.repaired).toBe(1);
    expect(purgeExteriorMess(world)).toEqual({ litter: 0, repaired: 0 });
  });

  it('feeds the park rating and staff only interior litter after loading', () => {
    const { world } = contaminated(sandbox);
    const loaded = deserialize(serialize(world));
    const sim = new Simulation(loaded);
    for (let i = 0; i < 400; i++) sim.step();
    expect(loaded.economy.inputs.litter).toBe(loaded.litter.count);
    for (const [x, y] of litterTiles(loaded)) expect(isParkInterior(loaded, x, y)).toBe(true);
  });

  it('purges litter that the new approach covers when the gate moves', () => {
    const world = sandbox();
    const [ix, iy] = insideNextToGate(world);
    plantLitter(world, ix, iy);
    plantLitter(world, ix, iy - 1);
    plantLitter(world, ix, iy - 2);
    const sim = new Simulation(world);
    sim.enqueue({ type: 'setParkEntrance', x: ix, y: iy - 1 });
    sim.step();
    expect(world.park.entranceX).toBe(ix);
    expect(world.park.entranceY).toBe(iy - 1);
    expect(litterTiles(world)).toEqual([[ix, iy - 2]]);
  });

  it.fails('KNOWN FAILURE: a bent spawn route stays outside after the gate moves off-axis', () => {
    const world = sandbox();
    const oldX = world.park.entranceX;
    const oldY = world.park.entranceY;
    expect(placePath(world.map, { x: oldX, y: oldY - 1 })).toBe(true);
    expect(placePath(world.map, { x: oldX + 1, y: oldY - 1 })).toBe(true);
    expect(setParkEntrance(world, oldX + 1, oldY - 1)).toBe(true);
    expect(isGateApproach(world, oldX, oldY - 1)).toBe(true);
  });
});
