import { describe, expect, it } from 'vitest';
import { Z_STEP } from '../core/constants';
import type { Simulation } from '../core/simulation';
import { GuestState } from '../guests/guest-store';
import { ElementType, Surface } from '../map/tile-map';
import { worldOccupancies } from '../map/occupancy';
import { spawnStaff, StaffKind } from '../staff/staff-store';
import { allWorldViews, withoutColumns } from '../../save/legacy-save-fixtures';
import { deserialize, serialize, SAVE_VERSION } from '../../save/save';
import { flatOwnedSim } from './coaster-fixtures';
import { BreakdownReason, repairTicksFor } from './breakdown-reasons';
import {
  DEFAULT_TOWER_HEIGHT,
  MAX_TOWER_HEIGHT,
  MIN_TOWER_HEIGHT,
  TOWER_CABIN_REST_MILLI,
  TOWER_LOAD_TICKS,
  TOWER_SECTION_COST,
  TOWER_TRAVEL_TICKS_PER_LEVEL,
  TOWER_UNLOAD_TICKS,
  TOWER_VIEW_TICKS,
  observationTowerCabinMilli,
  observationTowerCost,
  observationTowerParts,
  observationTowerReturnTicks,
  observationTowerRunTicks,
} from './observation-tower';
import { breakRide, serviceRide } from './ride-maintenance';
import {
  connectRideQueue,
  createRide,
  joinRideQueue,
  placeRideEntranceExit,
  setObservationTowerHeight,
  setRideOpen,
} from './ride-operations';
import { rideConstructionCost } from './ride-refund';
import { RideResult } from './ride-results';
import { rideSystem } from './ride-system';
import { RidePhase, RideState } from './ride-store';
import { RIDE_CATALOG, RideType } from './ride-types';

const TOWER_X = 20;
const TOWER_Y = 20;

function towerSim(height = DEFAULT_TOWER_HEIGHT): {
  sim: Simulation;
  rideId: number;
  slot: number;
} {
  const sim = flatOwnedSim();
  const rideId = createRide(sim.world, RideType.ObservationTower, TOWER_X, TOWER_Y, 0, height);
  return { sim, rideId, slot: sim.world.rides.idToSlot[rideId]! };
}

/** An open tower with a connected queue and one guest in line; returns the guest's slot. */
function openTowerWithRider(height: number): {
  sim: Simulation;
  rideId: number;
  slot: number;
  guest: number;
} {
  const { sim, rideId, slot } = towerSim(height);
  const w = sim.world;
  expect(
    placeRideEntranceExit(
      w,
      rideId,
      { x: TOWER_X, y: TOWER_Y + 1 },
      { x: TOWER_X + 1, y: TOWER_Y },
    ),
  ).toBe(true);
  const line = [
    { x: TOWER_X, y: TOWER_Y + 1 },
    { x: TOWER_X - 1, y: TOWER_Y + 1 },
    { x: TOWER_X - 1, y: TOWER_Y + 2 },
    { x: TOWER_X, y: TOWER_Y + 2 },
  ];
  for (const tile of [...line, { x: TOWER_X + 1, y: TOWER_Y }])
    w.map.surface[w.map.index(tile.x, tile.y)] = Surface.Path;
  expect(connectRideQueue(w, rideId, line)).toBe(true);
  expect(setRideOpen(w, rideId, true)).toBe(true);
  const guest = w.guests.spawn();
  w.guests.cols.targetRide[guest] = rideId;
  w.guests.cols.state[guest] = GuestState.Waiting;
  expect(joinRideQueue(w, rideId, 1)).toBe(true);
  return { sim, rideId, slot, guest };
}

interface Trace {
  load: number;
  run: number;
  unload: number;
  levels: number[];
  riderStates: number[];
}

/** Steps whole-simulation ticks through one dispatch, recording the cabin level while it runs. */
function traceOneTrip(height: number): Trace {
  const { sim, slot, guest } = openTowerWithRider(height);
  const ride = sim.world.rides.cols;
  const trace: Trace = { load: 0, run: 0, unload: 0, levels: [], riderStates: [] };
  let started = false;
  for (let tick = 0; tick < 20_000; tick++) {
    sim.step();
    const phase = ride.phase[slot];
    if (phase === RidePhase.Loading) trace.load++;
    if (phase === RidePhase.Running) {
      trace.run++;
      trace.levels.push(
        observationTowerCabinMilli(
          ride.towerHeight[slot],
          phase,
          ride.phaseTicks[slot],
          ride.runTicks[slot],
          ride.unloadTicks[slot],
        ) / 1_000,
      );
      trace.riderStates.push(sim.world.guests.cols.state[guest]);
    }
    if (phase === RidePhase.Unloading) {
      trace.unload++;
      trace.riderStates.push(sim.world.guests.cols.state[guest]);
    }
    if (phase !== RidePhase.Waiting) started = true;
    if (started && phase === RidePhase.Waiting) break;
  }
  return trace;
}

describe('Observation Tower height and travel time', () => {
  it('keeps the historical height as the default inside a valid range', () => {
    expect(DEFAULT_TOWER_HEIGHT).toBe(11);
    expect(MIN_TOWER_HEIGHT).toBeLessThan(DEFAULT_TOWER_HEIGHT);
    expect(MAX_TOWER_HEIGHT).toBeGreaterThan(DEFAULT_TOWER_HEIGHT);
  });

  it('keeps every encoded cabin height and return countdown within the 16-bit phase counter', () => {
    const top = Math.round((MAX_TOWER_HEIGHT - 4) * 1_000);
    expect(top).toBeLessThanOrEqual(0xffff);
    expect(TOWER_UNLOAD_TICKS + observationTowerReturnTicks(top)).toBeLessThanOrEqual(0xffff);
    expect(observationTowerRunTicks(MAX_TOWER_HEIGHT)).toBeLessThanOrEqual(0xffff);
  });

  it('lengthens the trip in proportion to the distance without raising the cabin speed', () => {
    const short = observationTowerRunTicks(MIN_TOWER_HEIGHT);
    const medium = observationTowerRunTicks(24);
    const tall = observationTowerRunTicks(MAX_TOWER_HEIGHT);

    expect(short).toBeLessThan(medium);
    expect(medium).toBeLessThan(tall);
    const perLevel = (a: number, ha: number, b: number, hb: number): number => (b - a) / (hb - ha);
    expect(perLevel(short, MIN_TOWER_HEIGHT, medium, 24)).toBeCloseTo(
      2 * TOWER_TRAVEL_TICKS_PER_LEVEL,
      0,
    );
    expect(perLevel(medium, 24, tall, MAX_TOWER_HEIGHT)).toBeCloseTo(
      2 * TOWER_TRAVEL_TICKS_PER_LEVEL,
      0,
    );
  });

  it.each([MIN_TOWER_HEIGHT, DEFAULT_TOWER_HEIGHT, 24, MAX_TOWER_HEIGHT])(
    'moves the %i-level cabin up once, holds, and returns once at a steady speed',
    (height) => {
      const trace = traceOneTrip(height);
      const step = 1 / TOWER_TRAVEL_TICKS_PER_LEVEL;
      const levels = trace.levels;

      expect(trace.run).toBe(observationTowerRunTicks(height));
      let direction = 0;
      let reversals = 0;
      for (let i = 1; i < levels.length; i++) {
        const delta = levels[i] - levels[i - 1];
        expect(Math.abs(delta)).toBeLessThanOrEqual(step + 0.002);
        const sign = Math.sign(Math.round(delta * 1_000));
        if (sign !== 0 && direction !== 0 && sign !== direction) reversals++;
        if (sign !== 0) direction = sign;
      }
      expect(reversals).toBe(1);
      expect(Math.max(...levels)).toBeCloseTo(height - 4, 5);
      expect(levels.filter((level) => level === Math.max(...levels))).toHaveLength(
        TOWER_VIEW_TICKS,
      );
    },
  );

  it('boards, holds riders aboard for the whole trip, and unloads them only at the station', () => {
    const trace = traceOneTrip(24);

    expect(trace.load).toBe(TOWER_LOAD_TICKS);
    expect(trace.unload).toBe(TOWER_UNLOAD_TICKS);
    expect(trace.riderStates.slice(0, trace.run)).toSatisfy((states: number[]) =>
      states.every((state) => state === GuestState.Riding),
    );
    expect(trace.levels[0]).toBeLessThan(1);
    expect(trace.levels.at(-1)).toBeLessThan(1);
  });

  it('serves the rider at the end of the cycle and leaves the ride waiting again', () => {
    const { sim, slot, guest } = openTowerWithRider(12);
    const ride = sim.world.rides.cols;
    for (let tick = 0; tick < 20_000 && ride.guestsServed[slot] === 0; tick++) sim.step();
    expect(ride.guestsServed[slot]).toBe(1);
    expect(ride.cyclesCompleted[slot]).toBe(1);
    sim.step();
    expect(sim.world.guests.cols.state[guest]).not.toBe(GuestState.Riding);
  });
});

describe('Observation Tower construction', () => {
  it('prices the base ride at the default height and each section above or below it', () => {
    const base = RIDE_CATALOG[RideType.ObservationTower].cost;
    expect(observationTowerCost(base, DEFAULT_TOWER_HEIGHT)).toBe(base);
    expect(observationTowerCost(base, 20)).toBe(base + 9 * TOWER_SECTION_COST);
    expect(observationTowerCost(base, MIN_TOWER_HEIGHT)).toBe(base - 3 * TOWER_SECTION_COST);
  });

  it('builds a chosen height through the create command with matching cost, travel and clearance', () => {
    const sim = flatOwnedSim();
    sim.world.research.unlocked.add(RideType.ObservationTower);
    const before = sim.world.economy.cash;
    sim.enqueue({
      type: 'createRide',
      rideType: RideType.ObservationTower,
      x: TOWER_X,
      y: TOWER_Y,
      towerHeight: 20,
    });
    sim.step();

    const slot = 0;
    const rideId = sim.world.rides.slotToId[slot]!;
    const tower = worldOccupancies(sim.world).find(
      (volume) => volume.name === 'Observation Tower 1',
    );
    expect(sim.world.rides.cols.towerHeight[slot]).toBe(20);
    expect(sim.world.rides.cols.runTicks[slot]).toBe(observationTowerRunTicks(20));
    expect(sim.world.economy.cash).toBe(
      before - observationTowerCost(RIDE_CATALOG[RideType.ObservationTower].cost, 20),
    );
    expect(tower?.clearance).toBe(tower!.base + 20 * Z_STEP);
    expect(rideConstructionCost(sim.world, rideId)).toBe(
      observationTowerCost(RIDE_CATALOG[RideType.ObservationTower].cost, 20),
    );
  });

  it('refuses heights outside the range when creating', () => {
    for (const towerHeight of [MIN_TOWER_HEIGHT - 1, MAX_TOWER_HEIGHT + 1, 12.5]) {
      const sim = flatOwnedSim();
      sim.world.research.unlocked.add(RideType.ObservationTower);
      const before = sim.world.economy.cash;
      sim.enqueue({
        type: 'createRide',
        rideType: RideType.ObservationTower,
        x: TOWER_X,
        y: TOWER_Y,
        towerHeight,
      });
      sim.step();
      expect(sim.world.rides.count).toBe(0);
      expect(sim.world.economy.cash).toBe(before);
    }
  });

  it('refuses to build a tower whose column hits an overhead obstruction', () => {
    for (const [towerHeight, count] of [
      [DEFAULT_TOWER_HEIGHT, 1],
      [40, 0],
    ] as const) {
      const fresh = flatOwnedSim();
      fresh.world.research.unlocked.add(RideType.ObservationTower);
      fresh.world.map.addElement(
        fresh.world.map.index(TOWER_X, TOWER_Y),
        ElementType.Wall,
        30,
        32,
        0,
        0,
      );
      fresh.enqueue({
        type: 'createRide',
        rideType: RideType.ObservationTower,
        x: TOWER_X,
        y: TOWER_Y,
        towerHeight,
      });
      fresh.step();
      expect(fresh.world.rides.count).toBe(count);
    }
  });

  it('edits a closed tower, charging added sections and refunding removed ones', () => {
    const { sim, rideId, slot } = towerSim();
    const ride = sim.world.rides.cols;
    const start = sim.world.economy.cash;

    expect(setObservationTowerHeight(sim.world, rideId, 14)).toBe(RideResult.Ok);
    expect(ride.towerHeight[slot]).toBe(14);
    expect(ride.runTicks[slot]).toBe(observationTowerRunTicks(14));
    expect(sim.world.economy.cash).toBe(start - 3 * TOWER_SECTION_COST);

    expect(setObservationTowerHeight(sim.world, rideId, 12)).toBe(RideResult.Ok);
    expect(sim.world.economy.cash).toBe(
      start - 3 * TOWER_SECTION_COST + Math.floor((2 * TOWER_SECTION_COST * 70) / 100),
    );
  });

  it('refuses an edit it cannot afford, out of range, while open, or into an obstruction', () => {
    const { sim, rideId, slot } = towerSim();
    const ride = sim.world.rides.cols;

    expect(setObservationTowerHeight(sim.world, rideId, MIN_TOWER_HEIGHT - 1)).toBe(
      RideResult.Blocked,
    );
    expect(setObservationTowerHeight(sim.world, rideId, MAX_TOWER_HEIGHT + 1)).toBe(
      RideResult.Blocked,
    );

    sim.world.economy.cash = TOWER_SECTION_COST - 1;
    expect(setObservationTowerHeight(sim.world, rideId, 12)).toBe(RideResult.InsufficientFunds);
    sim.world.economy.cash = 1_000_000;

    sim.world.map.addElement(sim.world.map.index(TOWER_X, TOWER_Y), ElementType.Wall, 12, 14, 0, 0);
    expect(setObservationTowerHeight(sim.world, rideId, 20)).toBe(RideResult.Blocked);
    expect(ride.towerHeight[slot]).toBe(DEFAULT_TOWER_HEIGHT);
    expect(setObservationTowerHeight(sim.world, rideId, 9)).toBe(RideResult.Ok);

    ride.state[slot] = RideState.Open;
    expect(setObservationTowerHeight(sim.world, rideId, 12)).toBe(RideResult.Busy);
  });

  it('describes the tower as a base, one shaft per level and a top', () => {
    const parts = observationTowerParts(14);
    expect(parts[0]).toEqual({ part: 'base', level: 0 });
    expect(parts.at(-1)).toEqual({ part: 'top', level: 11 });
    expect(parts.filter((p) => p.part === 'shaft')).toHaveLength(10);
  });
});

describe('Observation Tower breakdowns', () => {
  function stranded(height: number): { sim: Simulation; rideId: number; slot: number } {
    const { sim, rideId, slot } = openTowerWithRider(height);
    const ride = sim.world.rides.cols;
    while (ride.phase[slot] !== RidePhase.Running) sim.step();
    for (let tick = 0; tick < observationTowerRunTicks(height) / 4; tick++) sim.step();
    breakRide(sim.world, slot, BreakdownReason.SafetyCutOut);
    return { sim, rideId, slot };
  }

  function repair(sim: Simulation, rideId: number): void {
    expect(spawnStaff(sim.world, StaffKind.Mechanic)).toBe(true);
    const mechanic = sim.world.staff.slotToId[sim.world.staff.count - 1]!;
    for (let tick = 0; tick < repairTicksFor(BreakdownReason.SafetyCutOut); tick++) {
      sim.world.tick++;
      serviceRide(sim.world, rideId, mechanic);
    }
  }

  it('strands the cabin where it stopped and keeps its riders aboard', () => {
    const { sim, slot } = stranded(24);
    const ride = sim.world.rides.cols;
    const level = ride.phaseTicks[slot] / 1_000;

    expect(ride.phase[slot]).toBe(RidePhase.Broken);
    expect(level).toBeGreaterThan(3);
    expect(ride.boarded[slot]).toBe(1);
    for (let tick = 0; tick < 200; tick++) rideSystem.update(sim.world);
    expect(ride.phaseTicks[slot] / 1_000).toBe(level);
    expect(ride.boarded[slot]).toBe(1);
  });

  it('lowers the cabin at travel speed after repair and unloads only at the station', () => {
    const { sim, rideId, slot } = stranded(24);
    const ride = sim.world.rides.cols;
    const level = ride.phaseTicks[slot] / 1_000;
    repair(sim, rideId);

    expect(ride.phase[slot]).toBe(RidePhase.Unloading);
    const descent = ride.phaseTicks[slot] - ride.unloadTicks[slot];
    expect(descent).toBe(Math.ceil((level - 0.5) * TOWER_TRAVEL_TICKS_PER_LEVEL));
    for (let tick = 0; tick < descent; tick++) {
      expect(ride.boarded[slot]).toBe(1);
      rideSystem.update(sim.world);
    }
    expect(ride.phaseTicks[slot]).toBe(ride.unloadTicks[slot]);
    expect(ride.boarded[slot]).toBe(1);
    for (let tick = 0; tick < ride.unloadTicks[slot]; tick++) rideSystem.update(sim.world);
    expect(ride.boarded[slot]).toBe(0);
    expect(ride.guestsServed[slot]).toBe(1);
  });

  it('keeps the cabin height when it breaks down again on the way down', () => {
    const { sim, rideId, slot } = stranded(24);
    const ride = sim.world.rides.cols;
    repair(sim, rideId);
    for (let tick = 0; tick < 40; tick++) rideSystem.update(sim.world);
    const expected = observationTowerCabinMilli(
      24,
      ride.phase[slot],
      ride.phaseTicks[slot],
      ride.runTicks[slot],
      ride.unloadTicks[slot],
    );
    expect(expected).toBeGreaterThan(TOWER_CABIN_REST_MILLI);

    breakRide(sim.world, slot, BreakdownReason.SafetyCutOut);
    expect(ride.phase[slot]).toBe(RidePhase.Broken);
    expect(ride.phaseTicks[slot]).toBe(expected);
    expect(ride.boarded[slot]).toBe(1);
  });
});

describe('Observation Tower saves', () => {
  it('stores chosen heights in the current version', () => {
    const { sim, rideId } = towerSim(30);
    const loaded = deserialize(serialize(sim.world));
    const slot = loaded.rides.idToSlot[rideId]!;

    expect(SAVE_VERSION).toBeGreaterThanOrEqual(36);
    expect(loaded.rides.cols.towerHeight[slot]).toBe(30);
    expect(loaded.rides.cols.runTicks[slot]).toBe(observationTowerRunTicks(30));
  });

  function legacySave(
    configure: (sim: Simulation, slot: number) => void,
  ): ReturnType<typeof deserialize> {
    const { sim, slot } = openTowerWithRider(DEFAULT_TOWER_HEIGHT);
    const ride = sim.world.rides.cols;
    ride.towerHeight[slot] = 0;
    ride.loadTicks[slot] = 80;
    ride.unloadTicks[slot] = 80;
    ride.minWaitTicks[slot] = 80;
    ride.maxWaitTicks[slot] = 320;
    ride.runTicks[slot] = 400;
    configure(sim, slot);
    const bytes = withoutColumns(serialize(sim.world), 35, allWorldViews(sim.world), []);
    return deserialize(bytes);
  }

  it('loads a v35 tower at its historical height with the new cycle', () => {
    const world = legacySave(() => undefined);
    const ride = world.rides.cols;

    expect(ride.towerHeight[0]).toBe(DEFAULT_TOWER_HEIGHT);
    expect(ride.runTicks[0]).toBe(observationTowerRunTicks(DEFAULT_TOWER_HEIGHT));
    expect(ride.loadTicks[0]).toBe(TOWER_LOAD_TICKS);
    expect(ride.unloadTicks[0]).toBe(TOWER_UNLOAD_TICKS);
  });

  it('continues a v35 trip at the same fraction of the longer run', () => {
    const world = legacySave((sim, slot) => {
      const ride = sim.world.rides.cols;
      ride.phase[slot] = RidePhase.Running;
      ride.phaseTicks[slot] = 100;
      ride.boarded[slot] = 3;
    });
    const ride = world.rides.cols;

    expect(ride.phase[0]).toBe(RidePhase.Running);
    expect(ride.boarded[0]).toBe(3);
    expect(ride.phaseTicks[0]).toBe(Math.round(ride.runTicks[0] * 0.25));
    expect(ride.phaseTicks[0]).toBeLessThanOrEqual(ride.runTicks[0]);
  });

  it('rests a v35 broken tower cabin at the station', () => {
    const world = legacySave((sim, slot) => {
      const ride = sim.world.rides.cols;
      ride.state[slot] = RideState.Broken;
      ride.phase[slot] = RidePhase.Broken;
      ride.phaseTicks[slot] = 0;
    });
    const ride = world.rides.cols;

    expect(ride.phase[0]).toBe(RidePhase.Broken);
    expect(
      observationTowerCabinMilli(
        ride.towerHeight[0],
        ride.phase[0],
        ride.phaseTicks[0],
        ride.runTicks[0],
        ride.unloadTicks[0],
      ),
    ).toBe(TOWER_CABIN_REST_MILLI);
  });
});
