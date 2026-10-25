import { describe, expect, it } from 'vitest';
import { hashWorld } from '../core/hash';
import { World } from '../core/world';
import { RIDE_CATALOG, type RideTypeDef } from './ride-types';
import { RideMode } from './ride-modes';
import { createRide, getRideRatings } from './ride-operations';
import { RideState } from './ride-store';
import { parkInputsSystem } from '../economy/park-inputs';
import type { RideCategory } from './ride-types';

const CONTRACTS: ReadonlyArray<{
  name: string;
  category: RideCategory;
  capacity: number;
  cost: number;
  ratings: readonly [number, number, number];
  modes: readonly string[];
  runningCost: number;
  researchCategory: number;
  researchOrder: number;
  reliability: number;
}> = [
  {
    name: 'Haunted House',
    category: 'thrill',
    capacity: 16,
    cost: 420_000,
    ratings: [520, 390, 300],
    modes: ['Haunted house'],
    runningCost: 8_400,
    researchCategory: 3,
    researchOrder: 11,
    reliability: 6,
  },
  {
    name: 'Spiral Slide',
    category: 'gentle',
    capacity: 5,
    cost: 33_000,
    ratings: [150, 140, 90],
    modes: ['Single ride per admission', 'Unlimited rides per admission'],
    runningCost: 660,
    researchCategory: 1,
    researchOrder: 12,
    reliability: 4,
  },
  {
    name: 'Top Spin',
    category: 'thrill',
    capacity: 40,
    cost: 560_000,
    ratings: [650, 820, 620],
    modes: ['Swing'],
    runningCost: 11_200,
    researchCategory: 3,
    researchOrder: 13,
    reliability: 8,
  },
  {
    name: 'Enterprise',
    category: 'thrill',
    capacity: 24,
    cost: 480_000,
    ratings: [700, 650, 500],
    modes: ['Rotation'],
    runningCost: 9_600,
    researchCategory: 3,
    researchOrder: 14,
    reliability: 7,
  },
  {
    name: 'Go-Karts',
    category: 'thrill',
    capacity: 8,
    cost: 760_000,
    ratings: [620, 580, 450],
    modes: ['Race'],
    runningCost: 15_200,
    researchCategory: 3,
    researchOrder: 15,
    reliability: 5,
  },
  {
    name: 'Log Flume',
    category: 'water',
    capacity: 20,
    cost: 132_000,
    ratings: [620, 420, 320],
    modes: ['Continuous circuit', 'Boat hire'],
    runningCost: 30_000,
    researchCategory: 4,
    researchOrder: 16,
    reliability: 8,
  },
  {
    name: 'River Rapids',
    category: 'water',
    capacity: 36,
    cost: 155_000,
    ratings: [680, 500, 480],
    modes: ['Continuous circuit'],
    runningCost: 24_000,
    researchCategory: 4,
    researchOrder: 17,
    reliability: 10,
  },
  {
    name: 'Miniature Railway',
    category: 'transport',
    capacity: 16,
    cost: 450_000,
    ratings: [450, 180, 80],
    modes: ['Continuous circuit'],
    runningCost: 24_000,
    researchCategory: 0,
    researchOrder: 18,
    reliability: 5,
  },
  {
    name: 'Monorail',
    category: 'transport',
    capacity: 24,
    cost: 800_000,
    ratings: [520, 220, 100],
    modes: ['Continuous circuit', 'Shuttle'],
    runningCost: 40_000,
    researchCategory: 0,
    researchOrder: 19,
    reliability: 7,
  },
  {
    name: 'Chairlift',
    category: 'transport',
    capacity: 40,
    cost: 500_000,
    ratings: [500, 120, 50],
    modes: ['Station to station'],
    runningCost: 25_000,
    researchCategory: 0,
    researchOrder: 20,
    reliability: 6,
  },
  {
    name: 'Junior Roller Coaster',
    category: 'coaster',
    capacity: 8,
    cost: 132_000,
    ratings: [120, 60, 30],
    modes: ['Continuous circuit', 'Continuous circuit block sectioned'],
    runningCost: 26_000,
    researchCategory: 2,
    researchOrder: 21,
    reliability: 8,
  },
  {
    name: 'Wild Mouse Coaster',
    category: 'coaster',
    capacity: 16,
    cost: 190_000,
    ratings: [150, 80, 60],
    modes: ['Continuous circuit', 'Continuous circuit block sectioned'],
    runningCost: 38_000,
    researchCategory: 2,
    researchOrder: 22,
    reliability: 12,
  },
  {
    name: 'Observation Tower',
    category: 'gentle',
    capacity: 24,
    cost: 250_000,
    ratings: [420, 140, 80],
    modes: ['Rotation'],
    runningCost: 9_000,
    researchCategory: 1,
    researchOrder: 23,
    reliability: 4,
  },
  {
    name: 'Burger Stall',
    category: 'stall',
    capacity: 1,
    cost: 25_000,
    ratings: [0, 0, 0],
    modes: ['Shop'],
    runningCost: 2_500,
    researchCategory: 5,
    researchOrder: 24,
    reliability: 0,
  },
];

function makeWorld(seed: number): World {
  return new World({ seed, width: 32, height: 32 });
}

function definition(name: string): RideTypeDef | undefined {
  return Object.values(RIDE_CATALOG).find((ride) => ride.name === name);
}

describe('expanded ride catalog', () => {
  it('adds the requested base-game ride families across the build categories', () => {
    const names = Object.values(RIDE_CATALOG).map((ride) => ride.name);
    for (const { name } of CONTRACTS) expect(names).toContain(name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(Object.values(RIDE_CATALOG).map((ride) => ride.category))).toEqual(
      new Set(['transport', 'gentle', 'thrill', 'coaster', 'water', 'stall', 'facility']),
    );
  });

  it.each(CONTRACTS)(
    '$name uses its authored category, capacity, cost, ratings, operating modes and research group',
    (expected) => {
      const def = definition(expected.name);
      expect(def, expected.name).toBeDefined();
      if (!def) return;
      expect(def.category).toBe(expected.category);
      expect(def.capacity).toBe(expected.capacity);
      expect(def.cost).toBe(expected.cost);
      expect([def.baseExcitement, def.baseIntensity, def.baseNausea]).toEqual(expected.ratings);
      expect(def.modes.map(({ name }) => name)).toEqual(expected.modes);
      expect(Number.isInteger(def.unreliability), def.name).toBe(true);
      expect(def.unreliability).toBe(expected.reliability);
      expect(def.runningCostPerFortnightCents).toBe(expected.runningCost);
      expect(def.researchCategory).toBe(expected.researchCategory);
      expect(def.researchOrder).toBe(expected.researchOrder);
      expect(Number.isInteger(def.researchWorkUnits), def.name).toBe(true);
    },
  );

  it('computes the catalog rating output consistently from the selected mode for each type', () => {
    const world = makeWorld(764);
    for (const expected of CONTRACTS) {
      const def = definition(expected.name);
      expect(def, expected.name).toBeDefined();
      if (!def) continue;
      const rideId = createRide(world, def.id, 8, 8);
      const ratings = getRideRatings(world, rideId);
      expect([ratings.excitement, ratings.intensity, ratings.nausea], expected.name).toEqual(
        expected.ratings,
      );
    }
  });

  it('produces stable initial ratings and world hashes for every added ride type', () => {
    const first = makeWorld(764);
    const replay = makeWorld(764);

    for (const expected of CONTRACTS) {
      const def = definition(expected.name);
      expect(def, expected.name).toBeDefined();
      if (!def) continue;
      const rideA = createRide(first, def.id, 8, 8);
      const rideB = createRide(replay, def.id, 8, 8);
      expect(getRideRatings(first, rideA), expected.name).toEqual(getRideRatings(replay, rideB));
    }

    expect(hashWorld(first)).toBe(hashWorld(replay));
  });

  it('provides ride-specific operating modes instead of treating new rides as generic rotation rides', () => {
    const checks: readonly [string, RideMode][] = [
      ['Haunted House', RideMode.HauntedHouse],
      ['Spiral Slide', RideMode.SpiralSlideSingle],
      ['Go-Karts', RideMode.Race],
      ['Log Flume', RideMode.BoatHire],
    ];
    for (const [name, mode] of checks) {
      const def = definition(name);
      expect(def, name).toBeDefined();
      if (def)
        expect(
          def.modes.map(({ mode: rideMode }) => rideMode),
          name,
        ).toContain(mode);
    }
  });

  it('charges each added ride its authored fortnightly running cost while open', () => {
    for (const expected of CONTRACTS) {
      const def = definition(expected.name);
      expect(def, expected.name).toBeDefined();
      if (!def) continue;
      const world = makeWorld(9);
      const rideId = createRide(world, def.id, 8, 8);
      world.rides.cols.state[world.rides.idToSlot[rideId]] = RideState.Open;
      parkInputsSystem.update(world);
      expect(world.economy.inputs.rideUpkeepPerFortnight, expected.name).toBe(expected.runningCost);
    }
  });
});
