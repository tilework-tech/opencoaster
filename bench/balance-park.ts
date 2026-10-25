import { Simulation } from '../src/sim/core/simulation';
import { readFileSync } from 'node:fs';
import { parseScenarioFile } from '../src/sim/scenario/scenario-file';
import { prepareScenario } from '../src/sim/scenario/scenario-layout';
import { RideType } from '../src/sim/rides/ride-types';
import { RIDE_CATALOG } from '../src/sim/rides/ride-types';
import { RideState } from '../src/sim/rides/ride-store';
import { StaffKind } from '../src/sim/staff/staff-store';
import { buildCircuit, GROUND, SMALL_CIRCUIT } from '../src/sim/rides/coaster-fixtures';
import { TICKS_PER_MONTH } from '../src/sim/economy/calendar';

export const TICKS_PER_YEAR = TICKS_PER_MONTH * 8;

const SPINE_TOP = 18;
const SPINE_BOTTOM = 43;
const COASTER_STATION = { x: 20, y: 20 };
const COASTER_TEST_TICKS = 6000;

type Side = 'east' | 'west';

interface Placement {
  type: RideType;
  side: Side;
  /** Tile row of the ride; the exit path uses the next row. */
  y: number;
  /** Distance of the ride tile from the spine; the queue fills the gap. */
  reach: number;
}

const FIRST_WAVE: Placement[] = [
  { type: RideType.MerryGoRound, side: 'east', y: 41, reach: 6 },
  { type: RideType.FerrisWheel, side: 'west', y: 41, reach: 6 },
  { type: RideType.FoodStall, side: 'east', y: 39, reach: 2 },
  { type: RideType.DrinkStall, side: 'west', y: 39, reach: 2 },
  { type: RideType.Toilets, side: 'east', y: 37, reach: 2 },
];

const SECOND_WAVE: Placement[] = [
  { type: RideType.SwingingShip, side: 'east', y: 29, reach: 6 },
  { type: RideType.Twist, side: 'west', y: 29, reach: 6 },
  { type: RideType.InformationKiosk, side: 'west', y: 37, reach: 2 },
  { type: RideType.FoodStall, side: 'west', y: 33, reach: 2 },
  { type: RideType.DrinkStall, side: 'east', y: 33, reach: 2 },
];

const THIRD_WAVE: Placement[] = [
  { type: RideType.Toilets, side: 'west', y: 25, reach: 2 },
  { type: RideType.FoodStall, side: 'east', y: 25, reach: 2 },
  { type: RideType.DrinkStall, side: 'west', y: 21, reach: 2 },
];

/** Extra attractions a keen player adds in months 3 to 5. */
const EXPANSION: Placement[] = [
  { type: RideType.FerrisWheel, side: 'east', y: 35, reach: 6 },
  { type: RideType.SwingingShip, side: 'west', y: 35, reach: 6 },
  { type: RideType.Twist, side: 'east', y: 31, reach: 6 },
  { type: RideType.MerryGoRound, side: 'west', y: 31, reach: 6 },
  { type: RideType.SwingingShip, side: 'east', y: 27, reach: 6 },
  { type: RideType.FerrisWheel, side: 'west', y: 27, reach: 6 },
  { type: RideType.Twist, side: 'east', y: 23, reach: 6 },
  { type: RideType.SwingingShip, side: 'west', y: 23, reach: 6 },
  { type: RideType.MerryGoRound, side: 'east', y: 21, reach: 6 },
];

/**
 * minimal: first wave only, no staff. modest: all three waves and the coaster.
 * ambitious: modest plus EXPANSION, one attraction per fortnight from the third month.
 */
export type BalanceProfile = 'minimal' | 'modest' | 'ambitious';

export interface BalanceOptions {
  seed?: number;
  profile?: BalanceProfile;
}

/**
 * A scripted starter park: a footpath spine north from the gate with rides, stalls and a
 * queue for every attraction, then a wooden coaster added in the second month. Everything is
 * driven through the same commands a player issues.
 */
export interface BalancePark {
  sim: Simulation;
  /** Runs any construction steps that fall due at the current tick. */
  runSchedule(): void;
}

/** Column of the footpath spine; set from the gate the scenario lays out. */
let SPINE_X = 0;

function pathRun(sim: Simulation, x0: number, x1: number, y: number, queue = false): void {
  const [a, b] = x0 <= x1 ? [x0, x1] : [x1, x0];
  for (let x = a; x <= b; x++) sim.enqueue({ type: 'placePath', x, y, queue });
}

function place(sim: Simulation, p: Placement): number {
  const dir = p.side === 'east' ? 1 : -1;
  const rideX = SPINE_X + dir * p.reach;
  const entranceX = rideX - dir;
  const nearSpine = SPINE_X + dir;
  const lo = Math.min(nearSpine, entranceX);
  const hi = Math.max(nearSpine, entranceX);
  const category = RIDE_CATALOG[p.type].category;
  const serviceRide = category === 'stall' || category === 'facility';
  pathRun(sim, lo, hi, p.y, !serviceRide);
  pathRun(sim, Math.min(nearSpine, rideX), Math.max(nearSpine, rideX), p.y + 1);
  sim.enqueue({ type: 'createRide', rideType: p.type, x: rideX, y: p.y });
  sim.step();
  const rideId = sim.world.rides.slotToId[sim.world.rides.count - 1];
  sim.enqueue({ type: 'placeRideEntrance', rideId, x: entranceX, y: p.y });
  sim.enqueue({ type: 'placeRideExit', rideId, x: rideX, y: p.y + 1 });
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
  sim.step();
  return rideId;
}

/** Paths for a coaster whose station sits at COASTER_STATION: queue west, exit under the track. */
function layCoasterPaths(sim: Simulation): void {
  const { x, y } = COASTER_STATION;
  pathRun(sim, x - 5, SPINE_X, SPINE_TOP);
  pathRun(sim, x - 4, x, y - 1, true);
  for (const [px, py] of [
    [x, y + 1],
    [x + 1, y + 1],
    [x + 2, y + 1],
    [x + 2, y],
    [x + 2, y - 1],
  ]) {
    sim.enqueue({ type: 'placePath', x: px, y: py });
  }
}

function buildCoaster(sim: Simulation): number {
  const { x, y } = COASTER_STATION;
  sim.enqueue({ type: 'createRide', rideType: RideType.WoodenCoaster, x, y: y - 4 });
  sim.step();
  const rideId = sim.world.rides.slotToId[sim.world.rides.count - 1];
  buildCircuit(sim, rideId, SMALL_CIRCUIT);
  layCoasterPaths(sim);
  sim.enqueue({ type: 'placeRideEntrance', rideId, x, y: y - 1 });
  sim.enqueue({ type: 'placeRideExit', rideId, x, y: y + 1 });
  sim.step();
  return rideId;
}

export function createBalancePark(options: BalanceOptions = {}): BalancePark {
  const { seed, profile = 'modest' } = options;
  const minimal = profile === 'minimal';
  const ambitious = profile === 'ambitious';
  const def = parseScenarioFile(
    JSON.parse(
      readFileSync(new URL('../src/sim/scenario/scenarios/starter.json', import.meta.url), 'utf8'),
    ),
  );
  const sim = new Simulation({
    seed: seed ?? def.seed,
    width: def.mapWidth,
    height: def.mapHeight,
  });
  const map = sim.world.map;
  map.waterLevel.fill(0);
  map.fillFlat(GROUND);
  prepareScenario(sim.world, def);
  SPINE_X = sim.world.park.entranceX;

  for (let y = SPINE_TOP + 1; y <= SPINE_BOTTOM; y++) {
    sim.enqueue({ type: 'placePath', x: SPINE_X, y });
  }
  if (!minimal) {
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
    sim.enqueue({ type: 'hireStaff', kind: StaffKind.Mechanic });
  }
  sim.step();

  const done = { first: false, second: false, coaster: false, coasterOpen: false };
  let expanded = 0;
  let coasterId = -1;
  let coasterTestAt = 0;
  return {
    sim,
    runSchedule() {
      const tick = sim.world.tick;
      if (!done.first) {
        done.first = true;
        for (const p of FIRST_WAVE) place(sim, p);
      }
      if (minimal) return;
      if (!done.second && tick >= TICKS_PER_MONTH) {
        done.second = true;
        for (const p of SECOND_WAVE) place(sim, p);
        sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
        sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
      }
      if (!done.coaster && tick >= TICKS_PER_MONTH * 2) {
        done.coaster = true;
        for (const p of THIRD_WAVE) place(sim, p);
        coasterId = buildCoaster(sim);
        sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
        sim.enqueue({ type: 'hireStaff', kind: StaffKind.Handyman });
        sim.enqueue({ type: 'setRideStatus', rideId: coasterId, status: 'test' });
        coasterTestAt = sim.world.tick + COASTER_TEST_TICKS;
      }
      if (ambitious && expanded < EXPANSION.length) {
        const due = Math.floor((tick - TICKS_PER_MONTH * 2) / (TICKS_PER_MONTH / 2)) + 1;
        while (expanded < Math.min(due, EXPANSION.length)) place(sim, EXPANSION[expanded++]);
      }
      if (done.coaster && !done.coasterOpen && sim.world.tick >= coasterTestAt) {
        done.coasterOpen = true;
        sim.enqueue({ type: 'setRideStatus', rideId: coasterId, status: 'open' });
      }
    },
  };
}

export function openRideCount(sim: Simulation): number {
  const r = sim.world.rides.cols;
  let n = 0;
  for (let s = 0; s < sim.world.rides.count; s++) if (r.state[s] === RideState.Open) n++;
  return n;
}
