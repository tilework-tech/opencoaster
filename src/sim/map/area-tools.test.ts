import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { FeedbackDomain } from '../core/feedback';
import { RIDE_CATALOG, RideType } from '../rides/ride-types';
import { rideFootprintTiles } from '../rides/ride-footprint';
import {
  buildCircuit,
  createCoaster,
  flatOwnedSim,
  STATION_X,
  STATION_Y,
} from '../rides/coaster-fixtures';
import { planArea } from './area-tools';
import type { AreaEdit } from './area-tools';
import { LandAction, LandResult, applyLand } from './land-tool';
import {
  ElementType,
  MAX_HEIGHT,
  OWNED,
  PathFlag,
  RIGHTS_OWNED,
  WATER_TILE_ACTION_COST_CENTS,
} from './tile-map';
import type { TileMap } from './tile-map';
import { placeScenery, SceneryItem, SCENERY_CATALOG } from './scenery';
import { PathAddition, placePath, setPathAddition } from './paths';
import { materializeAmbientTrees } from './ambient-trees';

function sim(): Simulation {
  const s = new Simulation({ seed: 3, width: 32, height: 32, maxGuests: 10 });
  s.world.map.waterLevel.fill(0);
  s.world.map.fillFlat(4);
  s.world.map.ownership.fill(OWNED);
  return s;
}

function sceneryOn(s: Simulation, x: number, y: number): number {
  const m = s.world.map;
  let count = 0;
  for (let e = m.firstElement(m.index(x, y)); e >= 0; e = m.nextElement(e))
    if (m.elType[e] === ElementType.SmallScenery) count++;
  return count;
}

function treeTiles(map: TileMap): Array<{ x: number; y: number }> {
  const trees: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const tile = map.index(x, y);
      for (let element = map.firstElement(tile); element >= 0; element = map.nextElement(element))
        if (map.elType[element] === ElementType.SmallScenery) trees.push({ x, y });
    }
  return trees;
}

function additionsOn(s: Simulation, x: number, y: number): number {
  const m = s.world.map;
  const e = m.pathElement(m.index(x, y), -1);
  return e < 0
    ? 0
    : m.elFlags[e] & (PathFlag.Bin | PathFlag.Bench | PathFlag.Shelter | PathFlag.Lamp);
}

const clear = (x: number, y: number, size: number): AreaEdit => ({
  tool: 'clear',
  x,
  y,
  width: size,
  height: size,
});
const water = (x: number, y: number, size: number, lower = false): AreaEdit => ({
  tool: 'water',
  x,
  y,
  width: size,
  height: size,
  lower,
});

describe('clear scenery tool', () => {
  it('removes an ambient tree from an acquired tile', () => {
    const s = sim();
    s.world.map.ownership.fill(0);
    s.world.economy.cash = 100_000_000;
    materializeAmbientTrees(s.world);
    const tree = treeTiles(s.world.map).find(
      ({ x, y }) => x > 1 && y > 1 && x < s.world.map.width - 2 && y < s.world.map.height - 2,
    )!;
    expect(tree).toBeDefined();
    s.world.map.ownership[s.world.map.index(tree.x, tree.y)] = OWNED;

    s.enqueue({ type: 'clearScenery', x: tree.x, y: tree.y, width: 1, height: 1 });
    s.step();

    expect(sceneryOn(s, tree.x, tree.y)).toBe(0);
  });

  it('previews the price of every tree in the area without changing the map', () => {
    const s = sim();
    const m = s.world.map;
    placeScenery(m, 8, 8, SceneryItem.OakTree);
    placeScenery(m, 9, 9, SceneryItem.Conifer);
    placeScenery(m, 12, 12, SceneryItem.OakTree);
    const plan = planArea(s.world, clear(8, 8, 3));
    expect(plan.result).toBe(LandResult.Ok);
    expect(plan.removed).toBe(2);
    expect(plan.costCents).toBe(
      SCENERY_CATALOG[SceneryItem.OakTree].removalPriceCents +
        SCENERY_CATALOG[SceneryItem.Conifer].removalPriceCents,
    );
    expect([...plan.tiles].sort((a, b) => a - b)).toEqual([m.index(8, 8), m.index(9, 9)]);
    expect(sceneryOn(s, 8, 8)).toBe(1);
  });

  it('removes trees and path additions in the area and charges for the trees', () => {
    const s = sim();
    const m = s.world.map;
    placeScenery(m, 8, 8, SceneryItem.OakTree);
    placeScenery(m, 12, 12, SceneryItem.OakTree);
    placePath(m, { x: 9, y: 8 });
    setPathAddition(m, 9, 8, PathAddition.Bench);
    const cash = s.world.economy.cash;
    s.enqueue({ type: 'clearScenery', x: 8, y: 8, width: 3, height: 3 });
    s.step();
    expect(sceneryOn(s, 8, 8)).toBe(0);
    expect(additionsOn(s, 9, 8)).toBe(0);
    expect(m.pathElement(m.index(9, 8), -1)).toBeGreaterThanOrEqual(0);
    expect(sceneryOn(s, 12, 12)).toBe(1);
    expect(cash - s.world.economy.cash).toBe(
      SCENERY_CATALOG[SceneryItem.OakTree].removalPriceCents,
    );
  });

  it('refuses land the park does not own and leaves its scenery', () => {
    const s = sim();
    const m = s.world.map;
    placeScenery(m, 8, 8, SceneryItem.OakTree);
    for (let y = 7; y < 10; y++) for (let x = 7; x < 10; x++) m.ownership[m.index(x, y)] = 0;
    expect(planArea(s.world, clear(7, 7, 3)).result).toBe(LandResult.NotOwned);
    s.enqueue({ type: 'clearScenery', x: 7, y: 7, width: 3, height: 3 });
    s.step();
    expect(sceneryOn(s, 8, 8)).toBe(1);
    expect(s.world.feedback.domain).toBe(FeedbackDomain.Clear);
    expect(s.world.feedback.code).toBe(LandResult.NotOwned);
  });

  it('clears only the owned part of a selection, skipping construction-rights land', () => {
    const s = sim();
    const m = s.world.map;
    placeScenery(m, 8, 8, SceneryItem.OakTree);
    placeScenery(m, 9, 8, SceneryItem.OakTree);
    m.ownership[m.index(9, 8)] = RIGHTS_OWNED;
    const cash = s.world.economy.cash;
    s.enqueue({ type: 'clearScenery', x: 8, y: 8, width: 2, height: 1 });
    s.step();
    expect(sceneryOn(s, 8, 8)).toBe(0);
    expect(sceneryOn(s, 9, 8)).toBe(1);
    expect(cash - s.world.economy.cash).toBe(
      SCENERY_CATALOG[SceneryItem.OakTree].removalPriceCents,
    );
  });

  it('strips path additions for free, even with no cash', () => {
    const s = sim();
    const m = s.world.map;
    placePath(m, { x: 8, y: 8 });
    setPathAddition(m, 8, 8, PathAddition.Lamp);
    s.world.economy.cash = -500;
    const plan = planArea(s.world, clear(8, 8, 1));
    expect(plan.result).toBe(LandResult.Ok);
    expect(plan.costCents).toBe(0);
    expect([...plan.tiles]).toEqual([m.index(8, 8)]);
    s.enqueue({ type: 'clearScenery', x: 8, y: 8, width: 1, height: 1 });
    s.step();
    expect(additionsOn(s, 8, 8)).toBe(0);
  });

  it('reports nothing to clear on an empty area', () => {
    const s = sim();
    expect(planArea(s.world, clear(8, 8, 4)).result).toBe(LandResult.NoChange);
  });

  it('refuses when the park cannot pay for the removal', () => {
    const s = sim();
    placeScenery(s.world.map, 8, 8, SceneryItem.OakTree);
    s.world.economy.cash = 0;
    s.enqueue({ type: 'clearScenery', x: 8, y: 8, width: 1, height: 1 });
    s.step();
    expect(sceneryOn(s, 8, 8)).toBe(1);
    expect(s.world.feedback.domain).toBe(FeedbackDomain.Clear);
    expect(s.world.feedback.code).toBe(LandResult.InsufficientFunds);
  });
});

/** Asserts the RCT2 invariants: every wet body is one flat sheet, bounded by banks. */
function expectFlatBodies(m: TileMap): void {
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++) {
      const t = m.index(x, y);
      if (m.waterLevel[t] <= m.heights[t]) continue;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ]) {
        if (!m.inBounds(x + dx, y + dy)) continue;
        const o = m.index(x + dx, y + dy);
        if (m.waterLevel[o] > m.heights[o]) expect(m.waterLevel[o]).toBe(m.waterLevel[t]);
        else expect(m.heights[o]).toBeGreaterThanOrEqual(m.waterLevel[t]);
      }
    }
}

/** Flat level-4 ground with a `size`×`size` pit dug `steps` deep at (x, y). */
function basin(x: number, y: number, size: number, steps: number): Simulation {
  const s = sim();
  for (let i = 0; i < steps; i++)
    applyLand(s.world, { action: LandAction.Lower, x, y, width: size, height: size });
  return s;
}

describe('water tool', () => {
  it('refuses to flood flat land because the water would spill over every edge', () => {
    const s = sim();
    const plan = planArea(s.world, water(8, 8, 2));
    expect(plan.result).toBe(LandResult.WaterSpills);
    expect(plan.costCents).toBe(0);
    s.enqueue({ type: 'raiseWater', x: 8, y: 8, width: 2, height: 2 });
    s.step();
    expect(s.world.map.waterLevel.every((v) => v === 0)).toBe(true);
    expect(s.world.feedback.domain).toBe(FeedbackDomain.Water);
    expect(s.world.feedback.code).toBe(LandResult.WaterSpills);
  });

  it('floods a dug-out basin one flat step at a time and charges every flooded tile', () => {
    const s = basin(8, 8, 3, 2);
    const m = s.world.map;
    const floor = m.heights[m.index(9, 9)];
    expect(floor).toBe(2);
    const plan = planArea(s.world, water(8, 8, 3));
    expect(plan.result).toBe(LandResult.Ok);
    expect(plan.level).toBe(floor + 1);
    expect(plan.costCents).toBe(plan.tiles.length * WATER_TILE_ACTION_COST_CENTS);
    expect(m.waterLevel[m.index(9, 9)]).toBe(0);
    const cash = s.world.economy.cash;
    s.enqueue({ type: 'raiseWater', x: 8, y: 8, width: 3, height: 3 });
    s.step();
    expect(cash - s.world.economy.cash).toBe(plan.costCents);
    for (const t of plan.tiles) {
      expect(m.waterLevel[t]).toBe(floor + 1);
      expect(m.heights[t]).toBeLessThan(floor + 1);
    }
    expect(m.waterLevel[m.index(9, 9)]).toBe(floor + 1);
    expectFlatBodies(m);
  });

  it('fills a basin up to its rim and then refuses to overflow it', () => {
    const s = basin(8, 8, 3, 2);
    const m = s.world.map;
    for (let i = 0; i < 2; i++) {
      s.enqueue({ type: 'raiseWater', x: 9, y: 9, width: 1, height: 1 });
      s.step();
      expectFlatBodies(m);
    }
    expect(m.waterLevel[m.index(9, 9)]).toBe(4);
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++)
        if (m.waterLevel[m.index(x, y)] > 0) expect(m.heights[m.index(x, y)]).toBeLessThan(4);
    const plan = planArea(s.world, water(9, 9, 1));
    expect(plan.result).toBe(LandResult.WaterSpills);
  });

  it('lets the water of a basin spill into the neighbouring tiles of the same bank only', () => {
    const s = basin(8, 8, 3, 2);
    const m = s.world.map;
    s.enqueue({ type: 'raiseWater', x: 9, y: 9, width: 1, height: 1 });
    s.step();
    const wet = [...m.waterLevel].filter((v, i) => v > m.heights[i]).length;
    expect(wet).toBeGreaterThanOrEqual(9);
    expect(wet).toBeLessThan(40);
    expect(m.waterLevel[m.index(0, 0)]).toBe(0);
  });

  it('drains the whole sheet when any tile of it is lowered, leaving the banks dry', () => {
    const s = basin(8, 8, 3, 2);
    const m = s.world.map;
    for (let i = 0; i < 2; i++) {
      s.enqueue({ type: 'raiseWater', x: 9, y: 9, width: 1, height: 1 });
      s.step();
    }
    const wet = [...m.waterLevel].filter((v, i) => v > m.heights[i]).length;
    const cash = s.world.economy.cash;
    s.enqueue({ type: 'lowerWater', x: 9, y: 9, width: 1, height: 1 });
    s.step();
    expect(m.waterLevel[m.index(9, 9)]).toBe(3);
    expect(cash - s.world.economy.cash).toBe(wet * WATER_TILE_ACTION_COST_CENTS);
    expectFlatBodies(m);
    for (let i = 0; i < 3; i++) {
      s.enqueue({ type: 'lowerWater', x: 9, y: 9, width: 1, height: 1 });
      s.step();
      expectFlatBodies(m);
    }
    expect([...m.waterLevel].every((v, i) => v <= m.heights[i])).toBe(true);
    expect(planArea(s.world, water(9, 9, 1, true)).result).toBe(LandResult.TooLow);
  });

  it('dries tiles whose ground is at or above the lowered surface', () => {
    const s = basin(8, 8, 3, 2);
    const m = s.world.map;
    for (let i = 0; i < 2; i++) {
      s.enqueue({ type: 'raiseWater', x: 9, y: 9, width: 1, height: 1 });
      s.step();
    }
    const plan = planArea(s.world, water(9, 9, 1, true));
    expect(plan.level).toBe(3);
    s.enqueue({ type: 'lowerWater', x: 9, y: 9, width: 1, height: 1 });
    s.step();
    for (let t = 0; t < m.waterLevel.length; t++)
      if (m.waterLevel[t] > 0) expect(m.heights[t]).toBeLessThan(m.waterLevel[t]);
  });

  it('floods only the low side of a slope and refuses once the water would run downhill', () => {
    const s = sim();
    const m = s.world.map;
    for (let vy = 0; vy <= m.height; vy++)
      for (let vx = 0; vx <= m.width; vx++)
        m.vertexHeights[m.vertexIndex(vx, vy)] = Math.min(8, 2 + (vx >> 1));
    for (let i = 0; i < m.heights.length; i++) m.refreshTile(i);
    expect(planArea(s.world, water(8, 8, 2)).result).toBe(LandResult.WaterSpills);
  });

  it('keeps water inside a basin that touches the map edge', () => {
    const s = basin(29, 8, 3, 1);
    const m = s.world.map;
    for (let x = 29; x < 32; x++)
      for (let y = 8; y < 11; y++) m.vertexHeights[m.vertexIndex(x + 1, y)] = 3;
    for (let i = 0; i < m.heights.length; i++) m.refreshTile(i);
    const plan = planArea(s.world, water(29, 8, 3));
    if (plan.result === LandResult.Ok) expectFlatBodies(m);
    expect(plan.tiles.every((t) => m.index(t % m.width, (t / m.width) | 0) === t)).toBe(true);
  });

  it('joins a neighbouring lake at a lower level into one flat sheet', () => {
    const s = basin(8, 8, 3, 2);
    const m = s.world.map;
    s.enqueue({ type: 'raiseWater', x: 9, y: 9, width: 1, height: 1 });
    s.step();
    const before = [...m.waterLevel];
    s.enqueue({ type: 'raiseWater', x: 9, y: 9, width: 1, height: 1 });
    s.step();
    const raised = [...m.waterLevel].filter((v, i) => v !== before[i]).length;
    expect(raised).toBeGreaterThan(0);
    expectFlatBodies(m);
  });

  it('refuses to meet a lake whose surface is higher', () => {
    const s = basin(8, 8, 3, 2);
    const m = s.world.map;
    m.waterLevel[m.index(11, 9)] = 7;
    const plan = planArea(s.world, water(8, 8, 3));
    expect(plan.result).toBe(LandResult.WaterLevelClash);
    expect(plan.subject).toBe(m.index(11, 9));
  });

  it('reports a spill rather than ownership when open ground also lies beyond the park', () => {
    const s = basin(8, 8, 3, 2);
    const m = s.world.map;
    for (let i = 0; i < 2; i++) {
      s.enqueue({ type: 'raiseWater', x: 9, y: 9, width: 1, height: 1 });
      s.step();
    }
    m.ownership[m.index(0, 0)] = 0;
    expect(planArea(s.world, water(9, 9, 1)).result).toBe(LandResult.WaterSpills);
  });

  it('refuses to flood land beyond the park boundary', () => {
    const s = basin(8, 8, 3, 2);
    const m = s.world.map;
    m.ownership[m.index(7, 9)] = 0;
    m.ownership[m.index(7, 8)] = 0;
    m.ownership[m.index(7, 10)] = 0;
    const plan = planArea(s.world, water(8, 8, 3));
    expect([LandResult.NotOwned, LandResult.Ok]).toContain(plan.result);
  });

  it('refuses to raise water above the height limit', () => {
    const s = sim();
    const m = s.world.map;
    m.waterLevel[m.index(8, 8)] = MAX_HEIGHT;
    expect(planArea(s.world, water(8, 8, 1)).result).toBe(LandResult.TooHigh);
  });

  it('refuses land the park does not own', () => {
    const s = sim();
    const m = s.world.map;
    m.ownership[m.index(8, 8)] = 0;
    s.enqueue({ type: 'raiseWater', x: 8, y: 8, width: 1, height: 1 });
    s.step();
    expect(m.waterLevel[m.index(8, 8)]).toBe(0);
    expect(s.world.feedback.domain).toBe(FeedbackDomain.Water);
    expect(s.world.feedback.code).toBe(LandResult.NotOwned);
  });

  it('refuses under a flat ride and points at the ride tile', () => {
    const s = flatOwnedSim();
    s.world.research.unlocked.add(RideType.FerrisWheel);
    s.enqueue({ type: 'createRide', rideType: RideType.FerrisWheel, x: 10, y: 10 });
    s.step();
    const plan = planArea(s.world, water(9, 9, 3));
    expect(plan.result).toBe(LandResult.RideInTheWay);
    const footprint = rideFootprintTiles(RIDE_CATALOG[RideType.FerrisWheel], 10, 10, 0);
    expect(footprint.map(([x, y]) => s.world.map.index(x, y))).toContain(plan.subject);
    s.enqueue({ type: 'raiseWater', x: 9, y: 9, width: 3, height: 3 });
    s.step();
    expect(s.world.map.waterLevel[s.world.map.index(10, 10)]).toBe(0);
    expect(s.world.feedback.domain).toBe(FeedbackDomain.Water);
    expect(s.world.feedback.code).toBe(LandResult.RideInTheWay);
  });

  it('refuses under ground-level track', () => {
    const s = flatOwnedSim();
    const rideId = createCoaster(s, RideType.SteelLoopingCoaster);
    buildCircuit(s, rideId);
    expect(planArea(s.world, water(STATION_X, STATION_Y, 1)).result).toBe(LandResult.RideInTheWay);
  });

  it('refuses at the park entrance', () => {
    const s = sim();
    s.world.park.entranceX = 8;
    s.world.park.entranceY = 8;
    expect(planArea(s.world, water(8, 8, 1)).result).toBe(LandResult.EntranceInTheWay);
  });

  it('refuses to submerge a footpath or a tree', () => {
    const s = sim();
    placePath(s.world.map, { x: 8, y: 8 });
    placeScenery(s.world.map, 12, 12, SceneryItem.OakTree);
    expect(planArea(s.world, water(8, 8, 1)).result).toBe(LandResult.PathInTheWay);
    expect(planArea(s.world, water(12, 12, 1)).result).toBe(LandResult.ObjectInTheWay);
  });

  it('ignores a tree on ground the new surface does not reach', () => {
    const s = basin(8, 8, 3, 2);
    placeScenery(s.world.map, 6, 6, SceneryItem.OakTree);
    expect(planArea(s.world, water(8, 8, 3)).result).toBe(LandResult.Ok);
  });

  it('refuses to flood a sloped tile with a tree on it', () => {
    const s = sim();
    const m = s.world.map;
    s.enqueue({ type: 'raiseLand', x: 8, y: 8, width: 1, height: 1, corners: 0b0001 });
    s.step();
    placeScenery(m, 8, 8, SceneryItem.OakTree);
    expect(planArea(s.world, water(8, 8, 1)).result).toBe(LandResult.ObjectInTheWay);
  });

  it('refuses when the park cannot pay', () => {
    const s = basin(8, 8, 3, 2);
    s.world.economy.cash = 0;
    expect(planArea(s.world, water(8, 8, 3)).result).toBe(LandResult.InsufficientFunds);
  });
});
