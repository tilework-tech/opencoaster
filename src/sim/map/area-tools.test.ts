import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { FeedbackDomain } from '../core/feedback';
import { RideType } from '../rides/ride-types';
import {
  buildCircuit,
  createCoaster,
  flatOwnedSim,
  STATION_X,
  STATION_Y,
} from '../rides/coaster-fixtures';
import { planArea } from './area-tools';
import type { AreaEdit } from './area-tools';
import { LandResult } from './land-tool';
import {
  ElementType,
  MAX_HEIGHT,
  OWNED,
  PathFlag,
  RIGHTS_OWNED,
  WATER_TILE_ACTION_COST_CENTS,
} from './tile-map';
import { placeScenery, SceneryItem, SCENERY_CATALOG } from './scenery';
import { PathAddition, placePath, setPathAddition } from './paths';

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

describe('water tool', () => {
  it('floods dry land one step above the ground and charges per tile', () => {
    const s = sim();
    const m = s.world.map;
    const plan = planArea(s.world, water(8, 8, 2));
    expect(plan.result).toBe(LandResult.Ok);
    expect(plan.level).toBe(5);
    expect(plan.costCents).toBe(4 * WATER_TILE_ACTION_COST_CENTS);
    expect(m.waterLevel[m.index(8, 8)]).toBe(0);
    const cash = s.world.economy.cash;
    s.enqueue({ type: 'raiseWater', x: 8, y: 8, width: 2, height: 2 });
    s.step();
    for (const [x, y] of [
      [8, 8],
      [9, 8],
      [8, 9],
      [9, 9],
    ])
      expect(m.waterLevel[m.index(x, y)]).toBe(5);
    expect(m.waterLevel[m.index(10, 8)]).toBe(0);
    expect(cash - s.world.economy.cash).toBe(4 * WATER_TILE_ACTION_COST_CENTS);
  });

  it('raises the lowest water in the area first', () => {
    const s = sim();
    const m = s.world.map;
    s.enqueue({ type: 'raiseWater', x: 8, y: 8, width: 1, height: 1 });
    s.enqueue({ type: 'raiseWater', x: 8, y: 8, width: 1, height: 1 });
    s.step();
    expect(m.waterLevel[m.index(8, 8)]).toBe(6);
    s.enqueue({ type: 'raiseWater', x: 8, y: 8, width: 2, height: 1 });
    s.step();
    expect(m.waterLevel[m.index(8, 8)]).toBe(6);
    expect(m.waterLevel[m.index(9, 8)]).toBe(5);
  });

  it('lowers water a step at a time until the ground is dry', () => {
    const s = sim();
    const m = s.world.map;
    s.enqueue({ type: 'raiseWater', x: 8, y: 8, width: 2, height: 2 });
    s.enqueue({ type: 'raiseWater', x: 8, y: 8, width: 2, height: 2 });
    s.step();
    const cash = s.world.economy.cash;
    s.enqueue({ type: 'lowerWater', x: 8, y: 8, width: 2, height: 2 });
    s.step();
    expect(m.waterLevel[m.index(8, 8)]).toBe(5);
    expect(cash - s.world.economy.cash).toBe(4 * WATER_TILE_ACTION_COST_CENTS);
    s.enqueue({ type: 'lowerWater', x: 8, y: 8, width: 2, height: 2 });
    s.step();
    for (let y = 8; y < 10; y++)
      for (let x = 8; x < 10; x++)
        expect(m.waterLevel[m.index(x, y)] > m.heights[m.index(x, y)]).toBe(false);
    expect(planArea(s.world, water(8, 8, 2, true)).result).toBe(LandResult.TooLow);
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
    expect(plan.subject).toBe(s.world.map.index(10, 10));
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

  it('only refuses for a tree the raise would actually cover', () => {
    const s = sim();
    const m = s.world.map;
    s.enqueue({ type: 'raiseLand', x: 9, y: 8, width: 1, height: 1 });
    s.enqueue({ type: 'raiseLand', x: 9, y: 8, width: 1, height: 1 });
    s.step();
    placeScenery(m, 9, 8, SceneryItem.OakTree);
    expect(planArea(s.world, water(8, 8, 2)).result).toBe(LandResult.Ok);
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
    const s = sim();
    s.world.economy.cash = 0;
    expect(planArea(s.world, water(8, 8, 2)).result).toBe(LandResult.InsufficientFunds);
  });
});
