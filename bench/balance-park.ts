import { Simulation } from '../src/sim/core/simulation';
import { readFileSync } from 'node:fs';
import { parseScenarioFile } from '../src/sim/scenario/scenario-file';
import { prepareScenario } from '../src/sim/scenario/scenario-layout';
import { RIDE_CATALOG, RideType } from '../src/sim/rides/ride-types';
import { rideFootprintTiles } from '../src/sim/rides/ride-footprint';
import { RideState } from '../src/sim/rides/ride-store';
import { StaffKind } from '../src/sim/staff/staff-store';
import { buildCircuit, GROUND, SMALL_CIRCUIT } from '../src/sim/rides/coaster-fixtures';
import { TICKS_PER_MONTH } from '../src/sim/economy/calendar';

export const TICKS_PER_YEAR = TICKS_PER_MONTH * 8;

const SPINE_TOP = 18;
const SPINE_BOTTOM = 43;
const COASTER_STATION = { x: 20, y: 20 };
/** Last row beside the spine the coaster's track and paths reach on the west side. */
const COASTER_CLEARANCE_BOTTOM = 27;
const COASTER_TEST_TICKS = 6000;

type Side = 'east' | 'west';

interface Placement {
  type: RideType;
  side: Side;
  /** Distance of the ride's front tile from the spine; the queue fills the gap. */
  reach: number;
}

const FIRST_WAVE: Placement[] = [
  { type: RideType.MerryGoRound, side: 'east', reach: 6 },
  { type: RideType.FerrisWheel, side: 'west', reach: 6 },
  { type: RideType.FoodStall, side: 'east', reach: 2 },
  { type: RideType.DrinkStall, side: 'west', reach: 2 },
  { type: RideType.Toilets, side: 'east', reach: 2 },
];

const SECOND_WAVE: Placement[] = [
  { type: RideType.SwingingShip, side: 'east', reach: 6 },
  { type: RideType.Twist, side: 'west', reach: 6 },
  { type: RideType.InformationKiosk, side: 'west', reach: 2 },
  { type: RideType.FoodStall, side: 'west', reach: 2 },
  { type: RideType.DrinkStall, side: 'east', reach: 2 },
];

const THIRD_WAVE: Placement[] = [
  { type: RideType.Toilets, side: 'west', reach: 2 },
  { type: RideType.FoodStall, side: 'east', reach: 2 },
  { type: RideType.DrinkStall, side: 'west', reach: 2 },
];

/** Extra attractions a keen player adds in months 3 to 5. */
const EXPANSION: Placement[] = [
  { type: RideType.FerrisWheel, side: 'east', reach: 6 },
  { type: RideType.SwingingShip, side: 'west', reach: 6 },
  { type: RideType.Twist, side: 'east', reach: 6 },
  { type: RideType.MerryGoRound, side: 'west', reach: 6 },
  { type: RideType.SwingingShip, side: 'east', reach: 6 },
  { type: RideType.FerrisWheel, side: 'west', reach: 6 },
  { type: RideType.Twist, side: 'east', reach: 6 },
  { type: RideType.SwingingShip, side: 'west', reach: 6 },
  { type: RideType.MerryGoRound, side: 'east', reach: 6 },
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

/** Rows along the spine each side's paths and ride bodies already use. */
interface SideRows {
  paths: Set<number>;
  bodies: Set<number>;
}

const sideRows: Record<Side, SideRows> = {
  east: { paths: new Set(), bodies: new Set() },
  west: { paths: new Set(), bodies: new Set() },
};

/** Orientation whose footprint reaches furthest across the spine, so rides use few rows. */
function acrossSpine(type: RideType): { dir: number; rows: number } {
  let best = { dir: 0, rows: Infinity, span: -1 };
  for (let dir = 0; dir < 4; dir++) {
    const cells = rideFootprintTiles(RIDE_CATALOG[type], 0, 0, dir);
    const span = Math.max(...cells.map(([x]) => x)) - Math.min(...cells.map(([x]) => x)) + 1;
    const rows = Math.max(...cells.map(([, y]) => y)) - Math.min(...cells.map(([, y]) => y)) + 1;
    if (span > best.span) best = { dir, rows, span };
  }
  return best;
}

/**
 * First row, counting from the gate, where the ride's queue, exit and body fit beside the rides
 * already built on its side. Stalls sit by the spine and may stand beside a ride's body.
 */
function allocateRow(p: Placement, rows: number): number | null {
  const used = sideRows[p.side];
  const attraction = p.reach > 2;
  for (let y = SPINE_BOTTOM - 2; y > SPINE_TOP; y--) {
    const pathRows = attraction ? [y, y + 1, y + 2] : [y, y + 1];
    if (pathRows.some((r) => used.bodies.has(r) && attraction)) continue;
    if (pathRows.some((r) => used.paths.has(r))) continue;
    if (attraction) {
      let clear = true;
      for (let r = y; r > y - rows; r--) if (used.paths.has(r) || used.bodies.has(r)) clear = false;
      if (!clear || y - rows + 1 <= SPINE_TOP) continue;
      for (let r = y; r > y - rows; r--) used.bodies.add(r);
    }
    for (const r of pathRows) used.paths.add(r);
    return y;
  }
  return null;
}

/** Builds the placement and returns the ride id, or -1 when the spine has no room left for it. */
function place(sim: Simulation, p: Placement): number {
  const dir = p.side === 'east' ? 1 : -1;
  const attraction = p.reach > 2;
  const turn = attraction ? acrossSpine(p.type) : { dir: 0, rows: 1 };
  const y = allocateRow(p, turn.rows);
  if (y === null) return -1;
  const cells = rideFootprintTiles(RIDE_CATALOG[p.type], 0, 0, turn.dir);
  const frontRow = Math.max(...cells.map(([, cy]) => cy));
  const nearColumn =
    dir > 0 ? Math.min(...cells.map(([cx]) => cx)) : Math.max(...cells.map(([cx]) => cx));
  const frontCorner = cells.find(([cx, cy]) => cx === nearColumn && cy === frontRow) as [
    number,
    number,
  ];
  const frontX = SPINE_X + dir * p.reach;
  const anchorX = frontX - frontCorner[0];
  const anchorY = y - frontCorner[1];
  const entranceX = frontX - dir;
  const nearSpine = SPINE_X + dir;
  const lo = Math.min(nearSpine, entranceX);
  const hi = Math.max(nearSpine, entranceX);
  pathRun(sim, lo, hi, y, true);
  // An exit joins the path only on its front edge, which faces away from the ride: the exit path
  // runs one row further out than the exit itself.
  const exitRow = attraction ? y + 2 : y + 1;
  pathRun(sim, Math.min(nearSpine, frontX), Math.max(nearSpine, frontX), exitRow);
  const before = sim.world.rides.count;
  sim.enqueue({ type: 'createRide', rideType: p.type, x: anchorX, y: anchorY, dir: turn.dir });
  sim.step();
  if (sim.world.rides.count !== before + 1)
    throw new Error(`could not build ${RIDE_CATALOG[p.type].name} at ${anchorX},${anchorY}`);
  const rideId = sim.world.rides.slotToId[sim.world.rides.count - 1];
  const directAccess = ['stall', 'facility'].includes(RIDE_CATALOG[p.type].category);
  sim.enqueue({
    type: 'placeRideEntrance',
    rideId,
    x: directAccess ? frontX : entranceX,
    y: directAccess ? y + 1 : y,
  });
  if (!directAccess) sim.enqueue({ type: 'placeRideExit', rideId, x: frontX, y: y + 1 });
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
  sim.step();
  return rideId;
}

/** Paths for a coaster whose station sits at COASTER_STATION: queue west, exit under the track. */
function layCoasterPaths(sim: Simulation): void {
  const { x, y } = COASTER_STATION;
  pathRun(sim, x - 5, SPINE_X, SPINE_TOP);
  pathRun(sim, x - 4, x, y - 1, true);
  pathRun(sim, x, x + 5, y + 1);
  sim.enqueue({ type: 'placePath', x: x + 5, y });
  sim.enqueue({ type: 'placePath', x: x + 5, y: y - 1 });
  pathRun(sim, x + 3, x + 4, y - 1);
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
  // The rating harness isolates park balance from research pacing.
  sim.world.research.unlocked = new Set(Object.keys(RIDE_CATALOG).map(Number));
  SPINE_X = sim.world.park.entranceX;
  for (const rows of Object.values(sideRows)) {
    rows.paths.clear();
    rows.bodies.clear();
  }
  for (let y = SPINE_TOP; y <= COASTER_CLEARANCE_BOTTOM; y++) sideRows.west.bodies.add(y);

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
