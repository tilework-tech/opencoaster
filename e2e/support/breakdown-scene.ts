import { readFileSync } from 'node:fs';
import { TILE_UNITS } from '../../src/sim/core/constants';
import { Simulation } from '../../src/sim/core/simulation';
import { layPath, openRide, row } from '../../src/sim/integration/fixtures';
import { BreakdownReason } from '../../src/sim/rides/breakdown-reasons';
import {
  MechanicStatus,
  breakRide,
  getRideMechanicStatus,
  getRideDowntimePercent,
} from '../../src/sim/rides/ride-maintenance';
import { RideType } from '../../src/sim/rides/ride-types';
import { RideState } from '../../src/sim/rides/ride-store';
import { parseScenarioFile } from '../../src/sim/scenario/scenario-file';
import { prepareScenario } from '../../src/sim/scenario/scenario-layout';
import { StaffKind, spawnStaff } from '../../src/sim/staff/staff-store';
import type { Tile } from '../footpath-helpers';

/** The merry-go-round's footprint ends on this tile; its entrance and exit sit just beside it. */
export const BREAKDOWN_RIDE_CORNER: Tile = { x: 24, y: 44 };
const RIDE_ENTRANCE: Tile = { x: 22, y: 45 };
const RIDE_EXIT: Tile = { x: 25, y: 43 };
/** Buildable ground east of the exit: a path along y 43, then along y 42 to the mechanic's start. */
const PATH_TILES: Array<[number, number]> = [
  [RIDE_EXIT.x, RIDE_EXIT.y],
  ...row(43, 26, 30),
  ...row(42, 30, 38).filter(([x]) => x !== 30),
  [30, 42],
];
/** Queue line west of the entrance, ending on ordinary path. */
const QUEUE_TILES: Array<[number, number]> = row(45, 20, 22);
const MECHANIC_START: Tile = { x: 38, y: 42 };
/** Tiles the mechanic still has to walk when the scene freezes, so the frame shows them en route. */
const TILES_LEFT = 9;

export interface BreakdownScene {
  sim: Simulation;
  rideId: number;
  /** Tile the frozen mechanic stands on. */
  mechanic: Tile;
}

/**
 * A merry-go-round that has broken down (safety cut-out) with a hired mechanic walking along the
 * path towards it, simulated until the mechanic is a few tiles out.
 */
export function breakdownScene(): BreakdownScene {
  const scenario = parseScenarioFile(
    JSON.parse(
      readFileSync(
        new URL('../../src/sim/scenario/scenarios/starter.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const sim = new Simulation({
    seed: scenario.seed,
    width: scenario.mapWidth,
    height: scenario.mapHeight,
  });
  const world = sim.world;
  prepareScenario(world, scenario);
  layPath(world, PATH_TILES);
  layPath(world, QUEUE_TILES, true);
  layPath(world, [[19, 45]]);
  const rideSlot = openRide(
    world,
    RideType.MerryGoRound,
    [BREAKDOWN_RIDE_CORNER.x, BREAKDOWN_RIDE_CORNER.y],
    [RIDE_ENTRANCE.x, RIDE_ENTRANCE.y],
    [RIDE_EXIT.x, RIDE_EXIT.y],
    [
      [21, 45],
      [20, 45],
    ],
  );
  const rideId = world.rides.slotToId[rideSlot];
  if (!spawnStaff(world, StaffKind.Mechanic)) throw new Error('spawnStaff');
  const mechanicSlot = world.staff.count - 1;
  world.staff.cols.x[mechanicSlot] = MECHANIC_START.x * TILE_UNITS + TILE_UNITS / 2;
  world.staff.cols.y[mechanicSlot] = MECHANIC_START.y * TILE_UNITS + TILE_UNITS / 2;
  breakRide(world, rideSlot, BreakdownReason.SafetyCutOut);

  for (let tick = 0; tick < 4_000; tick++) {
    sim.step();
    const tileX = world.staff.cols.x[mechanicSlot] >> 8;
    const tileY = world.staff.cols.y[mechanicSlot] >> 8;
    const remaining = Math.abs(tileX - (RIDE_EXIT.x + 1)) + Math.abs(tileY - RIDE_EXIT.y);
    if (
      getRideMechanicStatus(world, rideId) === MechanicStatus.Heading &&
      remaining <= TILES_LEFT
    ) {
      return { sim, rideId, mechanic: { x: tileX, y: tileY } };
    }
  }
  throw new Error('the mechanic never set out for the broken ride');
}

/** A naturally rolled breakdown with an accumulated downtime window and no mechanic assigned. */
export function naturalBreakdownScene(): Omit<BreakdownScene, 'mechanic'> {
  const scenario = parseScenarioFile(
    JSON.parse(
      readFileSync(
        new URL('../../src/sim/scenario/scenarios/starter.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const sim = new Simulation({ seed: 17, width: scenario.mapWidth, height: scenario.mapHeight });
  const world = sim.world;
  prepareScenario(world, scenario);
  layPath(world, PATH_TILES);
  layPath(world, QUEUE_TILES, true);
  layPath(world, [[19, 45]]);
  const rideSlot = openRide(
    world,
    RideType.MerryGoRound,
    [BREAKDOWN_RIDE_CORNER.x, BREAKDOWN_RIDE_CORNER.y],
    [RIDE_ENTRANCE.x, RIDE_ENTRANCE.y],
    [RIDE_EXIT.x, RIDE_EXIT.y],
    [
      [21, 45],
      [20, 45],
    ],
  );
  const rideId = world.rides.slotToId[rideSlot];
  world.rides.cols.reliabilityRaw[rideSlot] = 5_000;

  while (world.rides.cols.state[rideSlot] !== RideState.Broken) sim.step();
  while (getRideDowntimePercent(world, rideId) === 0) sim.step();

  return { sim, rideId };
}
