import { readFileSync } from 'node:fs';
import { TILE_UNITS, TRACK_STEPS_PER_LEVEL } from '../../src/sim/core/constants';
import { Simulation } from '../../src/sim/core/simulation';
import { World } from '../../src/sim/core/world';
import { spawnGuest } from '../../src/sim/guests/guest-store';
import { setParkEntrance } from '../../src/sim/guests/park';
import { layPath, openRide } from '../../src/sim/integration/fixtures';
import { worldOccupancies } from '../../src/sim/map/occupancy';
import { PathAddition, setPathAddition } from '../../src/sim/map/paths';
import { placeScenery, SceneryItem } from '../../src/sim/map/scenery';
import { OWNED } from '../../src/sim/map/tile-map';
import { connectRideQueue } from '../../src/sim/rides/ride-operations';
import { RideType } from '../../src/sim/rides/ride-types';
import { parseScenarioFile } from '../../src/sim/scenario/scenario-file';
import { prepareScenario } from '../../src/sim/scenario/scenario-layout';
import { pieceByName } from '../../src/sim/track/catalog';
import { getConstructionCursor } from '../../src/sim/track/construction';
import { PieceMode } from '../../src/sim/track/track-types';
import { WeatherKind } from '../../src/sim/weather/weather';
import { TICKS_PER_NIGHT_CYCLE } from '../../src/render/night-lighting';
import { serialize } from '../../src/save/save';

export type Tile = readonly [x: number, y: number];

/** Where to point the camera for one README screenshot. */
export interface ReadmeView {
  /** File name without extension. */
  name: string;
  /** Tile the camera centres on, and the height level it is projected at. */
  focus: readonly [x: number, y: number, level: number];
  zoom: number;
  /** Wait until a car of this ride is inside the tile box [x0, y0, x1, y1] before capturing. */
  train?: { rideId: number; box: readonly [number, number, number, number]; minLevel?: number };
}

export interface ReadmePark {
  save: Uint8Array;
  views: ReadmeView[];
}

function scenarioWorld(id: string): World {
  const scenario = parseScenarioFile(
    JSON.parse(
      readFileSync(new URL(`../../src/sim/scenario/scenarios/${id}.json`, import.meta.url), 'utf8'),
    ),
  );
  const world = new World({
    seed: scenario.seed,
    width: scenario.mapWidth,
    height: scenario.mapHeight,
  });
  prepareScenario(world, scenario);
  return world;
}

/** Levels the tiles x0..x1, y0..y1 to `level`, clears them and buys them. */
function clearFlat(world: World, x0: number, y0: number, x1: number, y1: number, level: number) {
  const m = world.map;
  for (let vy = y0; vy <= y1 + 1; vy++)
    for (let vx = x0; vx <= x1 + 1; vx++) m.vertexHeights[m.vertexIndex(vx, vy)] = level;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = m.index(x, y);
      m.waterLevel[i] = 0;
      m.ownership[i] |= OWNED;
      for (let e = m.firstElement(i); e >= 0; e = m.firstElement(i)) m.removeElement(i, e);
    }
  for (let y = Math.max(0, y0 - 1); y <= Math.min(m.height - 1, y1 + 1); y++)
    for (let x = Math.max(0, x0 - 1); x <= Math.min(m.width - 1, x1 + 1); x++)
      m.refreshTile(m.index(x, y));
}

function line(from: Tile, to: Tile): Tile[] {
  const out: Tile[] = [];
  const dx = Math.sign(to[0] - from[0]);
  const dy = Math.sign(to[1] - from[1]);
  for (let [x, y] = from; ; x += dx, y += dy) {
    out.push([x, y]);
    if (x === to[0] && y === to[1]) return out;
  }
}

/** Tiles any ride, track, path or entrance stands on, so planting can leave them clear. */
function builtTiles(world: World): Set<string> {
  const out = new Set<string>();
  for (const volume of worldOccupancies(world))
    if (volume.kind !== 'scenery' && volume.kind !== 'terrain')
      out.add(`${volume.tileX},${volume.tileY}`);
  return out;
}

/** Plants `item` on each tile that nothing else stands on. */
function plant(world: World, built: Set<string>, tiles: readonly Tile[], item: SceneryItem) {
  for (const [x, y] of tiles) if (!built.has(`${x},${y}`)) placeScenery(world.map, x, y, item);
}

function furnish(world: World, tiles: readonly Tile[], every: number, kinds: PathAddition[]) {
  tiles.forEach(([x, y], k) => {
    if (k % every === 0) setPathAddition(world.map, x, y, kinds[(k / every) % kinds.length]!);
  });
}

interface FlatRide {
  type: RideType;
  /** Largest-x, largest-y corner of the unrotated footprint. */
  corner: Tile;
  entrance: Tile;
  /** Queue tiles from the entrance outwards. */
  queue: Tile[];
  /** Footpath tile the far end of the queue opens onto. */
  joins: Tile;
  exit: Tile;
  /** Footpath from the exit towards the rest of the network. */
  exitPath: Tile[];
}

function flatRide(world: World, ride: FlatRide): void {
  layPath(world, [ride.entrance, ...ride.queue], true);
  layPath(world, [ride.exit, ...ride.exitPath]);
  world.research.unlocked.add(ride.type);
  openRide(world, ride.type, ride.corner, ride.entrance, ride.exit, [...ride.queue, ride.joins]);
}

function stall(world: World, type: RideType, at: Tile, front: Tile): void {
  world.research.unlocked.add(type);
  openRide(world, type, at, front, at);
}

interface TrackRide {
  type: RideType;
  /** First station tile, its level and heading. */
  start: readonly [x: number, y: number, level: number, dir: number];
  layout: ReadonlyArray<readonly [string, PieceMode]>;
  entrance: Tile;
  queue: Tile[];
  joins: Tile;
  exit: Tile;
  exitPath: Tile[];
}

/** Builds, tests and opens a tracked ride; returns its id. */
function trackRide(sim: Simulation, ride: TrackRide): number {
  const world = sim.world;
  world.research.unlocked.add(ride.type);
  sim.enqueue({ type: 'createRide', rideType: ride.type, x: ride.start[0], y: ride.start[1] });
  sim.step();
  const rideId = world.rides.slotToId[world.rides.count - 1]!;
  buildTrack(sim, rideId, ride.start, ride.layout);
  if (!getConstructionCursor(world, rideId).closed) throw new Error('circuit is not closed');
  layPath(world, ride.queue, true);
  layPath(world, ride.exitPath);
  sim.enqueue({ type: 'placeRideEntrance', rideId, x: ride.entrance[0], y: ride.entrance[1] });
  sim.enqueue({ type: 'placeRideExit', rideId, x: ride.exit[0], y: ride.exit[1] });
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
  sim.step();
  const slot = world.rides.idToSlot[rideId]!;
  for (let tick = 0; world.rides.cols.tested[slot] === 0; tick++) {
    if (tick > 40_000) throw new Error('ride test did not finish');
    sim.step();
  }
  const chain = [ride.entrance, ...ride.queue, ride.joins].map(([x, y]) => ({ x, y }));
  if (!connectRideQueue(world, rideId, chain)) throw new Error('queue');
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
  sim.step();
  return rideId;
}

/** Places each piece at the construction cursor, starting at (x, y, level) heading `dir`. */
function buildTrack(
  sim: Simulation,
  rideId: number,
  start: readonly [x: number, y: number, level: number, dir: number],
  layout: ReadonlyArray<readonly [string, PieceMode]>,
): void {
  for (const [name, mode] of layout) {
    const cursor = getConstructionCursor(sim.world, rideId);
    const piece = pieceByName(name);
    if (!piece) throw new Error(`piece ${name}`);
    sim.enqueue({
      type: 'placeTrack',
      rideId,
      pieceType: piece.id,
      x: cursor.hasTrack ? cursor.x : start[0],
      y: cursor.hasTrack ? cursor.y : start[1],
      z: cursor.hasTrack ? cursor.z : start[2] * TRACK_STEPS_PER_LEVEL,
      dir: cursor.hasTrack ? cursor.dir : start[3],
      mode,
    });
    sim.step();
  }
}

/** Puts `count` guests on random footpath tiles from `tiles`. */
function populate(world: World, tiles: readonly Tile[], count: number): void {
  const g = world.guests.cols;
  for (let n = 0; n < count; n++) {
    if (!spawnGuest(world)) throw new Error('spawnGuest');
    const slot = world.guests.count - 1;
    const [x, y] = tiles[world.rng.int(tiles.length)]!;
    g.x[slot] = x * TILE_UNITS + 40 + world.rng.int(TILE_UNITS - 80);
    g.y[slot] = y * TILE_UNITS + 40 + world.rng.int(TILE_UNITS - 80);
    g.z[slot] = world.map.heightAt(g.x[slot], g.y[slot]);
    g.cash[slot] = 8_000;
    g.ridesTaken[slot] = 1;
  }
}

/** Runs the sim, keeping guests cheerful, rested and in funds so they stay and keep riding. */
function runHappy(sim: Simulation, ticks: number): void {
  const world = sim.world;
  for (let tick = 0; tick < ticks; tick++) {
    sim.step();
    if (world.tick % 100 !== 0) continue;
    const g = world.guests.cols;
    for (let slot = 0; slot < world.guests.count; slot++) {
      g.energy[slot] = Math.max(g.energy[slot], 140);
      g.happiness[slot] = Math.max(g.happiness[slot], 220);
      g.happinessTarget[slot] = Math.max(g.happinessTarget[slot], 220);
      g.cash[slot] = Math.max(g.cash[slot], 5_000);
      g.patience[slot] = Math.max(g.patience[slot], 600);
      g.nausea[slot] = Math.min(g.nausea[slot], 40);
      g.toilet[slot] = Math.min(g.toilet[slot], 60);
    }
  }
}

/** Runs until the clock of the day-night lighting reads `hour`. */
function runUntilHour(sim: Simulation, hour: number): void {
  const want = Math.floor((((hour - 8 + 24) % 24) / 24) * TICKS_PER_NIGHT_CYCLE);
  while (Math.floor(sim.world.tick % TICKS_PER_NIGHT_CYCLE) !== want) runHappy(sim, 1);
}

function fineWeather(world: World): void {
  world.weather.kind = WeatherKind.Sunny;
  world.weather.temperature = 24;
  world.weather.ticksUntilChange = 1_000_000;
}

const N = PieceMode.Normal;
const LIFT = PieceMode.ChainLift;
const rep = (n: number, name: string, mode = N): Array<[string, PieceMode]> =>
  Array.from({ length: n }, () => [name, mode]);

/**
 * A steel looping coaster that completes its circuit: a three-tile station, a six-step chain lift,
 * a banked turnaround, a drop into a vertical loop and a corkscrew, then an S-bend and two flat
 * turns back to the station.
 */
const LOOPING_COASTER: ReadonlyArray<readonly [string, PieceMode]> = [
  ['station', N],
  ['flatToUp25', LIFT],
  ...rep(6, 'up25', LIFT),
  ['up25ToFlat', LIFT],
  ['flat', N],
  ['flatToRightBank', N],
  ['mediumRightBanked', N],
  ['mediumRightBanked', N],
  ['rightBankToFlat', N],
  ['flatToDown25', N],
  ...rep(6, 'down25'),
  ['down25ToFlat', N],
  ['verticalLoopRight', N],
  ['corkscrewRight', N],
  ['sBendLeft', N],
  ['smallRight', N],
  ['largeRight', N],
  ...rep(5, 'flat'),
  ['station', N],
  ['station', N],
];

/** Deterministic generator of numbers in [0, 1) for natural-looking planting. */
function pseudoRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const TREES = [SceneryItem.OakTree, SceneryItem.BlossomTree, SceneryItem.BirchTree];
const GROUND = 7;

/**
 * Open Grounds grown into a busy park: a steel looping coaster at the back, two rows of flat
 * rides either side of a stall-lined avenue, a gate walk with flower beds and fountains, lamps and
 * benches, and a crowd of guests riding, queueing and shopping.
 */
export function midwayPark(): ReadmePark {
  const world = scenarioWorld('open-grounds');
  world.economy.cash = 100_000_000;
  fineWeather(world);
  clearFlat(world, 20, 28, 70, 74, GROUND);

  const avenue = line([30, 58], [64, 58]);
  const promenade = line([30, 51], [64, 51]);
  const southAvenue = line([30, 66], [64, 66]);
  const gateWalk = line([47, 59], [47, 74]);
  const northWalk = line([47, 52], [47, 57]);
  const walks = [...avenue, ...promenade, ...southAvenue, ...gateWalk, ...northWalk];
  layPath(world, walks);

  const north = (x: number): Pick<FlatRide, 'entrance' | 'queue' | 'joins'> => ({
    entrance: [x, 56],
    queue: [[x, 57]],
    joins: [x, 58],
  });
  const south = (x: number): Pick<FlatRide, 'entrance' | 'queue' | 'joins'> => ({
    entrance: [x, 68],
    queue: [[x, 67]],
    joins: [x, 66],
  });
  const rides: FlatRide[] = [
    {
      type: RideType.MerryGoRound,
      corner: [34, 55],
      ...north(32),
      exit: [34, 56],
      exitPath: [[34, 57]],
    },
    { type: RideType.Twist, corner: [40, 55], ...north(38), exit: [40, 56], exitPath: [[40, 57]] },
    {
      type: RideType.FerrisWheel,
      corner: [44, 55],
      ...north(44),
      exit: [45, 55],
      exitPath: [
        [45, 56],
        [45, 57],
      ],
    },
    {
      type: RideType.SpiralSlide,
      corner: [51, 55],
      ...north(50),
      exit: [51, 56],
      exitPath: [[51, 57]],
    },
    {
      type: RideType.TopSpin,
      corner: [56, 55],
      ...north(54),
      exit: [56, 56],
      exitPath: [[56, 57]],
    },
    {
      type: RideType.Enterprise,
      corner: [63, 55],
      ...north(61),
      exit: [63, 56],
      exitPath: [[63, 57]],
    },
    {
      type: RideType.SwingingShip,
      corner: [33, 73],
      ...south(33),
      exit: [34, 69],
      exitPath: [
        [34, 68],
        [34, 67],
      ],
    },
    {
      type: RideType.HauntedHouse,
      corner: [39, 71],
      ...south(37),
      exit: [39, 68],
      exitPath: [[39, 67]],
    },
    {
      type: RideType.ObservationTower,
      corner: [43, 69],
      ...south(43),
      exit: [44, 69],
      exitPath: [
        [44, 68],
        [44, 67],
      ],
    },
    {
      type: RideType.MerryGoRound,
      corner: [53, 71],
      ...south(51),
      exit: [53, 68],
      exitPath: [[53, 67]],
    },
    { type: RideType.Twist, corner: [58, 71], ...south(56), exit: [58, 68], exitPath: [[58, 67]] },
    {
      type: RideType.FerrisWheel,
      corner: [62, 72],
      ...south(62),
      exit: [63, 69],
      exitPath: [
        [63, 68],
        [63, 67],
      ],
    },
  ];
  for (const ride of rides) flatRide(world, ride);

  const stalls: RideType[] = [
    RideType.BurgerStall,
    RideType.DrinkStall,
    RideType.IceCreamStall,
    RideType.BalloonStall,
    RideType.CandyflossStall,
    RideType.PizzaStall,
    RideType.Toilets,
    RideType.InformationKiosk,
    RideType.PopcornStall,
    RideType.HatStall,
    RideType.ChipsStall,
    RideType.SouvenirStall,
    RideType.FoodStall,
    RideType.DrinkStall,
    RideType.IceCreamStall,
    RideType.BalloonStall,
  ];
  stalls.forEach((type, k) => {
    const x = 31 + 2 * k + (k >= 8 ? 2 : 0);
    stall(world, type, [x, 59], [x, 58]);
  });

  const sim = new Simulation(world);
  const coaster = trackRide(sim, {
    type: RideType.SteelLoopingCoaster,
    start: [41, 48, GROUND, 2],
    layout: LOOPING_COASTER,
    entrance: [43, 49],
    queue: [
      [43, 50],
      [44, 50],
      [45, 50],
      [46, 50],
    ],
    joins: [46, 51],
    exit: [41, 49],
    exitPath: [[41, 50]],
  });

  furnish(world, avenue, 3, [PathAddition.Lamp, PathAddition.Bench, PathAddition.Bin]);
  furnish(world, promenade, 3, [PathAddition.Lamp, PathAddition.Bench]);
  furnish(world, southAvenue, 3, [PathAddition.Lamp, PathAddition.Bench, PathAddition.Bin]);
  furnish(world, gateWalk, 2, [PathAddition.Lamp, PathAddition.Bench]);

  const built = builtTiles(world);
  for (let x = 30; x <= 64; x++) {
    plant(world, built, [[x, 60]], x % 2 ? SceneryItem.FlowerBed : SceneryItem.Shrub);
    plant(world, built, [[x, 65]], x % 2 ? SceneryItem.Shrub : SceneryItem.FlowerBed);
  }
  for (let y = 59; y <= 74; y++) {
    plant(world, built, [[46, y]], y % 2 ? SceneryItem.FlowerBed : SceneryItem.LavenderRows);
    plant(world, built, [[48, y]], y % 2 ? SceneryItem.FlowerBed : SceneryItem.LavenderRows);
  }
  for (const x of [36, 58]) plant(world, built, [[x, 62]], SceneryItem.TieredFountain);
  for (const x of [42, 52]) plant(world, built, [[x, 63]], SceneryItem.JetFountain);
  const scatter = pseudoRandom(7);
  const sow = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    density: number,
    items: SceneryItem[],
  ) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (scatter() < density)
          plant(world, built, [[x, y]], items[Math.floor(scatter() * items.length)]!);
  };
  sow(30, 61, 64, 64, 0.45, [...TREES, SceneryItem.Shrub, SceneryItem.FlowerBed]);
  sow(26, 44, 51, 47, 0.3, [SceneryItem.FlowerBed, SceneryItem.LavenderRows, SceneryItem.Shrub]);
  sow(20, 28, 70, 42, 0.55, [
    SceneryItem.Conifer,
    SceneryItem.Conifer,
    SceneryItem.OakTree,
    SceneryItem.BirchTree,
    SceneryItem.AutumnTree,
  ]);
  sow(20, 43, 28, 74, 0.5, [...TREES, SceneryItem.Conifer]);
  sow(66, 43, 70, 74, 0.5, [...TREES, SceneryItem.Conifer]);
  sow(30, 52, 64, 52, 0.6, [SceneryItem.FlowerBed, SceneryItem.Shrub]);
  sow(30, 73, 64, 74, 0.5, TREES);

  populate(world, walks, 360);
  runHappy(sim, 8_000);
  runUntilHour(sim, 13);
  world.economy.cash = 4_825_000;
  return {
    save: serialize(world),
    views: [
      { name: 'park-overview', focus: [47, 58, GROUND], zoom: 1 },
      {
        name: 'steel-coaster',
        focus: [38, 47, GROUND + 2],
        zoom: 1,
        train: { rideId: coaster, box: [34, 43, 39, 44], minLevel: 8 },
      },
    ],
  };
}

const W = PieceMode.WaterLift;

/** A log flume: a station, a two-step water lift, a long run, a splash drop and the way home. */
const LOG_FLUME: ReadonlyArray<readonly [string, PieceMode]> = [
  ...rep(3, 'station'),
  ['flatToUp25', W],
  ...rep(2, 'up25', W),
  ['up25ToFlat', W],
  ...rep(2, 'flat'),
  ['smallRight', N],
  ...rep(3, 'flat'),
  ['smallRight', N],
  ['flat', N],
  ['waterSplashDrop', N],
  ['down25', N],
  ['down25', N],
  ['down25ToFlat', N],
  ...rep(4, 'flat'),
  ['smallRight', N],
  ...rep(3, 'flat'),
  ['smallRight', N],
];

const RIVERBANK = 5;

/**
 * Riverside Fairground at dusk: a lamp-lit promenade along the river, a log flume and a row of
 * stalls with the evening crowd still out.
 */
export function riversidePark(): ReadmePark {
  const world = scenarioWorld('riverside-fairground');
  world.economy.cash = 100_000_000;
  fineWeather(world);
  clearFlat(world, 17, 24, 46, 54, RIVERBANK);
  const promenade = line([19, 24], [19, 54]);
  const crossWalk = line([20, 38], [44, 38]);
  const southWalk = line([20, 45], [40, 45]);
  const walks = [...promenade, ...crossWalk, ...southWalk];
  layPath(world, walks);
  if (!setParkEntrance(world, 19, 54)) throw new Error('setParkEntrance');
  const sim = new Simulation(world);
  trackRide(sim, {
    type: RideType.LogFlume,
    start: [24, 30, RIVERBANK, 0],
    layout: LOG_FLUME,
    entrance: [25, 29],
    queue: [
      [25, 28],
      [24, 28],
      [23, 28],
      [22, 28],
      [21, 28],
      [20, 28],
    ],
    joins: [19, 28],
    exit: [24, 29],
    exitPath: [[24, 28]],
  });
  const rides: FlatRide[] = [
    {
      type: RideType.MerryGoRound,
      corner: [24, 42],
      entrance: [23, 39],
      queue: [],
      joins: [23, 38],
      exit: [24, 39],
      exitPath: [],
    },
    {
      type: RideType.FerrisWheel,
      corner: [28, 43],
      entrance: [28, 39],
      queue: [],
      joins: [28, 38],
      exit: [29, 40],
      exitPath: [[29, 39]],
    },
    {
      type: RideType.Twist,
      corner: [33, 42],
      entrance: [32, 39],
      queue: [],
      joins: [32, 38],
      exit: [33, 39],
      exitPath: [],
    },
    {
      type: RideType.TopSpin,
      corner: [24, 49],
      entrance: [23, 46],
      queue: [],
      joins: [23, 45],
      exit: [24, 46],
      exitPath: [],
    },
    {
      type: RideType.SpiralSlide,
      corner: [28, 48],
      entrance: [27, 46],
      queue: [],
      joins: [27, 45],
      exit: [28, 46],
      exitPath: [],
    },
    {
      type: RideType.Enterprise,
      corner: [34, 50],
      entrance: [32, 46],
      queue: [],
      joins: [32, 45],
      exit: [34, 46],
      exitPath: [],
    },
  ];
  for (const ride of rides) flatRide(world, ride);
  const crossStalls = [
    RideType.BurgerStall,
    RideType.DrinkStall,
    RideType.IceCreamStall,
    RideType.CandyflossStall,
  ];
  crossStalls.forEach((type, k) => stall(world, type, [37 + 2 * k, 37], [37 + 2 * k, 38]));
  const promenadeStalls = [
    RideType.PopcornStall,
    RideType.BalloonStall,
    RideType.Toilets,
    RideType.HatStall,
  ];
  promenadeStalls.forEach((type, k) => stall(world, type, [20, 47 + 2 * k], [19, 47 + 2 * k]));
  const southStalls = [RideType.PizzaStall, RideType.ChipsStall, RideType.SouvenirStall];
  southStalls.forEach((type, k) => stall(world, type, [26 + 4 * k, 44], [26 + 4 * k, 45]));
  furnish(world, promenade, 2, [PathAddition.Lamp]);
  furnish(world, promenade.slice(1), 4, [PathAddition.Bench]);
  furnish(world, crossWalk, 2, [PathAddition.Lamp, PathAddition.Lamp, PathAddition.Bin]);
  furnish(world, southWalk, 2, [PathAddition.Lamp, PathAddition.Bench]);

  const built = builtTiles(world);
  const scatter = pseudoRandom(11);
  const sow = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    density: number,
    items: SceneryItem[],
  ) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (scatter() < density)
          plant(world, built, [[x, y]], items[Math.floor(scatter() * items.length)]!);
  };
  sow(17, 24, 18, 54, 0.45, [SceneryItem.OakTree, SceneryItem.BirchTree]);
  sow(20, 24, 46, 27, 0.5, [...TREES, SceneryItem.Conifer]);
  sow(36, 28, 46, 36, 0.45, [...TREES, SceneryItem.FlowerBed]);
  sow(23, 31, 33, 35, 0.3, [SceneryItem.FlowerBed, SceneryItem.Shrub]);
  sow(21, 44, 46, 54, 0.4, [...TREES, SceneryItem.FlowerBed, SceneryItem.Shrub]);
  sow(35, 39, 46, 43, 0.4, [...TREES, SceneryItem.FlowerBed]);

  runUntilHour(sim, 18.1);
  populate(world, walks, 220);
  runUntilHour(sim, 19.9);
  world.economy.cash = 2_316_000;
  return {
    save: serialize(world),
    views: [{ name: 'riverside-night', focus: [23, 38, RIVERBANK], zoom: 2 }],
  };
}

/** README screenshot parks by shot name. */
export const README_PARKS: Record<string, () => ReadmePark> = {
  midway: midwayPark,
  riverside: riversidePark,
};
