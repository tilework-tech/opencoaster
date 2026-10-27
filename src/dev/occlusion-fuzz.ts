import { Simulation } from '../sim/core/simulation';
import type { Command } from '../sim/core/commands';
import { Prng } from '../sim/core/prng';
import { TILE_UNITS, Z_STEP } from '../sim/core/constants';
import { GuestState, HEADING_NONE, spawnGuest } from '../sim/guests/guest-store';
import { LitterKind, dropLitter } from '../sim/guests/litter-store';
import { PathAddition } from '../sim/map/paths';
import { SceneryItem } from '../sim/map/scenery';
import {
  DIR_DX,
  DIR_DY,
  OWNED,
  PathFlag,
  SALE_LAND,
  SALE_RIGHTS,
  Surface,
} from '../sim/map/tile-map';
import { RIDE_CATALOG, RideType } from '../sim/rides/ride-types';
import { rideFootprintTiles } from '../sim/rides/ride-footprint';
import { SMALL_CIRCUIT } from '../sim/rides/coaster-fixtures';
import { PIECES, pieceByName } from '../sim/track/catalog';
import { getConstructionCursor, rotateTile } from '../sim/track/construction';
import { extractMapData } from '../worker/map-data';
import { createSnapshot, writeSnapshot } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import type { MapData } from '../render/renderer';

/**
 * Deterministic, seeded park generator for the rendering-occlusion oracle. It builds a dense park
 * through the real simulation commands (terrain, footpaths, rides, a tested coaster, scenery) and
 * then scatters guests, staff and litter at sub-tile positions, returning exactly what the worker
 * would publish to the renderer. Safe to run in Node and on the browser main thread.
 */
export interface FuzzPark {
  map: MapData;
  snapshot: Snapshot;
  /** world tile coords + level of a point to centre the camera on */
  focus: { x: number; y: number; z: number };
  /** Centres of the park gate and of every ride entrance and exit tile, for close-up views. */
  landmarks: { gate: Landmark; boarding: Landmark[] };
}

/** Layout is designed on a 32-tile map; larger maps centre it. */
const LAYOUT_SIZE = 32;
const GROUND = 2;
/** Park area the camera should see: [AREA_MIN, AREA_MAX] in layout coordinates. */
const AREA_MIN = 5;
const AREA_MAX = 26;
const TEST_TICKS = 300;
const TREES: readonly SceneryItem[] = [
  SceneryItem.OakTree,
  SceneryItem.Conifer,
  SceneryItem.BlossomTree,
  SceneryItem.BirchTree,
  SceneryItem.AutumnTree,
  SceneryItem.TopiaryTree,
  SceneryItem.PalmTree,
  SceneryItem.CactusTree,
];
const WALLS: readonly SceneryItem[] = [
  SceneryItem.Hedge,
  SceneryItem.WoodenFence,
  SceneryItem.StoneFence,
];

type Tile = readonly [number, number];
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

class ParkBuilder {
  readonly sim: Simulation;
  readonly rng: Prng;
  /** Tiles that rides, track or deliberate gaps own; scenery and terrain bumps keep off them. */
  private readonly reserved: Uint8Array;
  readonly gate: Tile;
  readonly ramps: Tile[] = [];
  readonly queues: Array<{ tile: Tile; rideId: number }> = [];
  readonly boarding: Tile[] = [];
  readonly trees: Tile[] = [];
  readonly walls: Array<{ tile: Tile; edge: number }> = [];
  readonly coasterCells: Tile[] = [];

  constructor(
    seed: number,
    readonly size: number,
    private readonly off: number,
  ) {
    this.sim = new Simulation({ seed, width: size, height: size, maxGuests: 256 });
    this.rng = new Prng((seed ^ 0x0cc1d) >>> 0);
    this.reserved = new Uint8Array(size * size);
    this.gate = this.p(AREA_MIN, 17);
    const w = this.sim.world;
    for (const def of Object.values(RIDE_CATALOG)) w.research.unlocked.add(def.id);
    w.economy.cash = 1_000_000_000;
    w.map.waterLevel.fill(0);
    w.map.fillFlat(GROUND);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        w.map.ownership[y * size + x] = x > 0 && y > 0 && x < size - 1 && y < size - 1 ? OWNED : 0;
    w.map.revision++;
  }

  /** Map tile for a layout coordinate. */
  p(x: number, y: number): Tile {
    return [x + this.off, y + this.off];
  }

  pick<T>(items: readonly T[]): T {
    return items[this.rng.int(items.length)]!;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }

  /** Applies one command now; true when the world changed in the way the command intends. */
  apply(command: Command): boolean {
    const w = this.sim.world;
    const revision = w.map.revision;
    const rides = w.rides.count;
    const seq = w.feedback.seq;
    this.sim.enqueue(command);
    this.sim.applyPendingCommands();
    switch (command.type) {
      case 'createRide':
        return w.rides.count > rides;
      case 'placeRideEntrance':
      case 'placeRideExit':
      case 'setRideStatus':
      case 'placeTrack':
        return w.feedback.seq !== seq && w.feedback.code === 0;
      default:
        return w.map.revision !== revision;
    }
  }

  require(command: Command, what: string): void {
    if (!this.apply(command)) throw new Error(`occlusion fuzz: ${what} was refused`);
  }

  reserve(x: number, y: number): void {
    if (this.inBounds(x, y)) this.reserved[y * this.size + x] = 1;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  isReserved(x: number, y: number): boolean {
    return this.reserved[y * this.size + x] === 1;
  }

  hasPath(x: number, y: number): boolean {
    const m = this.sim.world.map;
    return this.inBounds(x, y) && m.isWalkable(m.index(x, y));
  }

  isFree(x: number, y: number): boolean {
    const m = this.sim.world.map;
    if (!this.inBounds(x, y) || this.isReserved(x, y)) return false;
    const i = m.index(x, y);
    return m.firstElement(i) < 0 && m.waterLevel[i]! <= m.heights[i]! && m.canBuild(i);
  }

  areaTiles(): Tile[] {
    const out: Tile[] = [];
    for (let y = AREA_MIN; y <= AREA_MAX; y++)
      for (let x = AREA_MIN; x <= AREA_MAX; x++) out.push(this.p(x, y));
    return out;
  }

  pathTiles(filter: (flags: number) => boolean = () => true): Tile[] {
    const m = this.sim.world.map;
    return this.areaTiles().filter(([x, y]) => {
      const e = m.pathElement(m.index(x, y), -1);
      return e >= 0 && filter(m.elFlags[e]!);
    });
  }

  path(x: number, y: number, queue = false): boolean {
    const [mx, my] = this.p(x, y);
    return this.apply({ type: 'placePath', x: mx, y: my, queue });
  }

  pathRow(y: number, x0: number, x1: number): void {
    for (let x = x0; x <= x1; x++) this.path(x, y);
  }

  pathColumn(x: number, y0: number, y1: number): void {
    for (let y = y0; y <= y1; y++) this.path(x, y);
  }

  raise(x: number, y: number, width: number, height: number, levels: number): void {
    const [mx, my] = this.p(x, y);
    for (let i = 0; i < levels; i++)
      this.require({ type: 'raiseLand', x: mx, y: my, width, height }, 'raising land');
  }

  /** Builds a flat ride or stall; returns its id or -1 when the site was refused. */
  flatRide(
    rideType: RideType,
    at: Tile,
    entrance: Tile,
    exit: Tile | null,
    queue: readonly Tile[] = [],
  ): number {
    const w = this.sim.world;
    const [x, y] = this.p(at[0], at[1]);
    if (!this.apply({ type: 'createRide', rideType, x, y })) return -1;
    const rideId = w.rides.slotToId[w.rides.count - 1]!;
    for (const [tx, ty] of rideFootprintTiles(RIDE_CATALOG[rideType], x, y, 0))
      this.reserve(tx, ty);
    for (const [qx, qy] of queue) {
      if (this.path(qx, qy, true)) this.queues.push({ tile: this.p(qx, qy), rideId });
    }
    const [ex, ey] = this.p(entrance[0], entrance[1]);
    if (this.apply({ type: 'placeRideEntrance', rideId, x: ex, y: ey })) {
      this.boarding.push([ex, ey]);
      if (this.sim.world.map.isQueue(this.sim.world.map.index(ex, ey)))
        this.queues.push({ tile: [ex, ey], rideId });
    }
    if (exit) {
      const [xx, xy] = this.p(exit[0], exit[1]);
      if (this.apply({ type: 'placeRideExit', rideId, x: xx, y: xy })) this.boarding.push([xx, xy]);
    }
    return rideId;
  }

  coaster(rideType: RideType): number {
    const w = this.sim.world;
    const [sx, sy] = this.p(20, 20);
    this.require({ type: 'createRide', rideType, x: sx, y: sy }, 'creating the coaster');
    const rideId = w.rides.slotToId[w.rides.count - 1]!;
    for (const [name, mode] of SMALL_CIRCUIT) {
      const cursor = getConstructionCursor(w, rideId);
      this.require(
        {
          type: 'placeTrack',
          rideId,
          pieceType: pieceByName(name)!.id,
          x: cursor.hasTrack ? cursor.x : sx,
          y: cursor.hasTrack ? cursor.y : sy,
          z: cursor.hasTrack ? cursor.z : GROUND,
          dir: cursor.hasTrack ? cursor.dir : 0,
          mode,
        },
        `coaster piece ${name}`,
      );
    }
    const pieces = w.track.pieces;
    for (let s = 0; s < pieces.count; s++) {
      if (pieces.cols.rideId[s] !== rideId) continue;
      for (const cell of PIECES[pieces.cols.pieceType[s]!]!.footprint) {
        const [rx, ry] = rotateTile(cell.i, cell.j, pieces.cols.dir[s]!);
        this.reserve(pieces.cols.x[s]! + rx, pieces.cols.y[s]! + ry);
        this.coasterCells.push([pieces.cols.x[s]! + rx, pieces.cols.y[s]! + ry]);
      }
    }
    // Queue zig-zags from the main path down to the station entrance, beside the lift hill.
    for (const [qx, qy] of [
      [22, 18],
      [22, 19],
      [21, 19],
    ] as const) {
      if (this.path(qx, qy, true)) this.queues.push({ tile: this.p(qx, qy), rideId });
    }
    const [ex, ey] = this.p(20, 19);
    this.require({ type: 'placeRideEntrance', rideId, x: ex, y: ey }, 'coaster entrance');
    this.queues.push({ tile: [ex, ey], rideId });
    const [xx, xy] = this.p(20, 21);
    this.require({ type: 'placeRideExit', rideId, x: xx, y: xy }, 'coaster exit');
    this.boarding.push([ex, ey], [xx, xy]);
    return rideId;
  }

  /** Places a tree, shrub or flower bed on a free tile; returns whether it stood. */
  scenery(x: number, y: number, item: SceneryItem): boolean {
    if (!this.isFree(x, y)) return false;
    return this.apply({ type: 'placeScenery', x, y, item, rotation: this.rng.int(4) });
  }

  /** Free tiles in the area with a footpath across one of their edges. */
  pathSideTiles(): Array<{ tile: Tile; edge: number }> {
    const out: Array<{ tile: Tile; edge: number }> = [];
    for (const [x, y] of this.areaTiles()) {
      if (!this.isFree(x, y)) continue;
      for (let d = 0; d < 4; d++)
        if (this.hasPath(x + DIR_DX[d]!, y + DIR_DY[d]!)) out.push({ tile: [x, y], edge: d });
    }
    return out;
  }
}

function buildTerrain(b: ParkBuilder): void {
  const terraceLevels = 2 + b.rng.int(2);
  b.raise(16, 5, 10, 8, terraceLevels);
  b.raise(5, 5, 3, 3, 2 + b.rng.int(2));
  const pondY = 20 + b.rng.int(4);
  const [px, py] = b.p(6, pondY);
  b.require({ type: 'lowerLand', x: px, y: py, width: 4, height: 3 }, 'digging the pond');
  b.require(
    { type: 'setWater', x: px, y: py, width: 4, height: 3, level: GROUND },
    'filling the pond',
  );
  for (let y = pondY - 1; y <= pondY + 3; y++)
    for (let x = 5; x <= 10; x++) b.reserve(...b.p(x, y));
  const [dx, dy] = b.p(16, 5);
  b.apply({ type: 'paintLand', x: dx, y: dy, width: 10, height: 8, surface: b.pick([1, 4, 5]) });
  const [sx, sy] = b.p(6 + b.rng.int(4), 24);
  b.apply({ type: 'paintLand', x: sx, y: sy, width: 3, height: 2, surface: Surface.Sand });
}

function buildPaths(b: ParkBuilder): void {
  b.pathRow(17, AREA_MIN, AREA_MAX);
  b.pathColumn(12, 6, AREA_MAX);
  // Ramp up the terrace: flat approach, then pieces that follow the slope ring.
  b.pathColumn(20, 11, 16);
  b.pathRow(10, 17, 24);
  b.pathRow(26, 13, 17);
  b.pathColumn(17, 18, 26);
  const m = b.sim.world.map;
  for (let y = 11; y <= 16; y++) {
    const [x, ty] = b.p(20, y);
    const e = m.pathElement(m.index(x, ty), -1);
    if (e >= 0 && m.elFlags[e]! & PathFlag.Sloped) b.ramps.push([x, ty]);
  }
  if (b.ramps.length === 0) throw new Error('occlusion fuzz: terrace ramp has no sloped pieces');
  const [gx, gy] = b.gate;
  if (!b.apply({ type: 'setParkEntrance', x: gx, y: gy })) {
    const park = b.sim.world.park;
    if (park.entranceX !== gx || park.entranceY !== gy)
      throw new Error('occlusion fuzz: park gate was refused');
  }
}

function buildRides(b: ParkBuilder): number {
  const carousel = b.flatRide(
    b.pick([RideType.MerryGoRound, RideType.Twist, RideType.TopSpin]),
    [22, 7],
    [22, 9],
    [21, 9],
  );
  if (carousel < 0) throw new Error('occlusion fuzz: terrace flat ride was refused');
  const west = b.pick([RideType.SpiralSlide, RideType.FerrisWheel]);
  b.flatRide(
    west,
    west === RideType.SpiralSlide ? [8, 13] : [9, 14],
    [10, 14],
    [10, 13],
    [[11, 14]],
  );
  b.path(11, 13);
  if (b.flatRide(RideType.ObservationTower, [15, 20], [15, 19], [14, 20], [[15, 18]]) < 0)
    throw new Error('occlusion fuzz: single-tile ride was refused');
  b.path(13, 20);
  b.flatRide(
    b.pick([RideType.FoodStall, RideType.DrinkStall, RideType.BurgerStall]),
    [11, 8],
    [12, 8],
    null,
  );
  b.flatRide(RideType.Toilets, [11, 11], [12, 11], null);
  b.flatRide(RideType.InformationKiosk, [16, 25], [17, 25], null);
  const coaster = b.coaster(b.pick([RideType.WoodenCoaster, RideType.SteelLoopingCoaster]));
  const w = b.sim.world;
  for (let slot = 0; slot < w.rides.count; slot++) {
    const rideId = w.rides.slotToId[slot]!;
    if (rideId !== coaster) b.apply({ type: 'setRideStatus', rideId, status: 'open' });
  }
  return coaster;
}

function buildAdditions(b: ParkBuilder): void {
  const plain = b.shuffle(b.pathTiles((f) => (f & (PathFlag.Queue | PathFlag.Sloped)) === 0));
  const additions = [PathAddition.Bench, PathAddition.Bin, PathAddition.Lamp, PathAddition.Shelter];
  let placed = 0;
  for (const [x, y] of plain) {
    if (placed >= 4 && b.rng.int(3) !== 0) continue;
    const addition = placed < 4 ? additions[placed]! : b.pick(additions);
    if (b.apply({ type: 'setPathAddition', x, y, addition })) placed++;
  }
  if (placed < 4) throw new Error('occlusion fuzz: path additions were refused');
}

function buildBumps(b: ParkBuilder): void {
  const near = (x: number, y: number): boolean => {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        if (
          !b.inBounds(x + dx, y + dy) ||
          b.isReserved(x + dx, y + dy) ||
          b.hasPath(x + dx, y + dy)
        )
          return true;
    return false;
  };
  const candidates = b.shuffle(b.areaTiles().filter(([x, y]) => b.isFree(x, y) && !near(x, y)));
  for (const [x, y] of candidates.slice(0, 6)) {
    const corners = b.pick([1, 2, 4, 8, 3, 6, 12, 9]);
    b.apply({
      type: b.rng.int(3) === 0 ? 'lowerLand' : 'raiseLand',
      x,
      y,
      width: 1,
      height: 1,
      corners,
    });
  }
}

function buildScenery(b: ParkBuilder): void {
  const beside = b.shuffle(b.pathSideTiles());
  let trees = 0;
  let walls = 0;
  for (const { tile, edge } of beside) {
    const [x, y] = tile;
    const roll = b.rng.int(10);
    if (roll < 3 && b.scenery(x, y, b.pick(TREES))) {
      b.trees.push(tile);
      trees++;
    } else if (roll < 5 && b.isFree(x, y)) {
      if (b.apply({ type: 'placeScenery', x, y, item: b.pick(WALLS), rotation: edge })) {
        b.walls.push({ tile, edge });
        walls++;
      }
    } else if (roll < 6) {
      b.scenery(x, y, b.pick([SceneryItem.Shrub, SceneryItem.FlowerBed]));
    }
  }
  const rest = b.shuffle(b.areaTiles().filter(([x, y]) => b.isFree(x, y)));
  for (const [x, y] of rest) {
    const roll = b.rng.int(10);
    if (roll < 3 && b.scenery(x, y, b.pick(TREES))) {
      b.trees.push([x, y]);
      trees++;
    } else if (roll < 4) b.scenery(x, y, b.pick([SceneryItem.Shrub, SceneryItem.FlowerBed]));
  }
  if (trees < 3 || walls < 1) throw new Error('occlusion fuzz: too little scenery stood');
}

function runCoasterTest(b: ParkBuilder, coaster: number): void {
  b.require({ type: 'setRideStatus', rideId: coaster, status: 'test' }, 'testing the coaster');
  for (let i = 0; i < TEST_TICKS; i++) b.sim.step();
  const v = b.sim.world.vehicles;
  for (let slot = 0; slot < v.count; slot++) {
    if (v.cols.rideId[slot] !== coaster) continue;
    const capacity = v.cols.capacity[slot]!;
    v.cols.passengers[slot] = capacity - b.rng.int((capacity >> 1) + 1);
  }
}

function placeGuests(b: ParkBuilder): void {
  const w = b.sim.world;
  const m = w.map;
  const g = w.guests.cols;
  const spot = (tile: Tile, bias: number = -1): [number, number] => {
    let fx = 24 + b.rng.int(TILE_UNITS - 48);
    let fy = 24 + b.rng.int(TILE_UNITS - 48);
    if (bias >= 0) {
      if (DIR_DX[bias]) fx = DIR_DX[bias]! > 0 ? 200 + b.rng.int(40) : 16 + b.rng.int(40);
      if (DIR_DY[bias]) fy = DIR_DY[bias]! > 0 ? 200 + b.rng.int(40) : 16 + b.rng.int(40);
    }
    return [tile[0] * TILE_UNITS + fx, tile[1] * TILE_UNITS + fy];
  };
  const add = (tile: Tile, state = GuestState.Wandering, rideId = -1, bias = -1): void => {
    if (!spawnGuest(w)) return;
    const slot = w.guests.count - 1;
    const [x, y] = spot(tile, bias);
    g.x[slot] = x;
    g.y[slot] = y;
    g.z[slot] = m.heightAt(x, y);
    g.targetX[slot] = tile[0];
    g.targetY[slot] = tile[1];
    g.state[slot] = state;
    g.targetRide[slot] = rideId;
    g.heading[slot] = b.rng.int(5) === 4 ? HEADING_NONE : b.rng.int(4);
  };
  const total = 60 + b.rng.int(61);
  for (let i = 0; i < 4; i++) add(b.gate);
  for (const tile of b.boarding) for (let i = 1 + b.rng.int(2); i > 0; i--) add(tile);
  for (const { tile, rideId } of b.queues)
    for (let i = 1 + b.rng.int(3); i > 0; i--) add(tile, GuestState.Queuing, rideId);
  for (const tile of b.pathTiles((f) => (f & PathFlag.Shelter) !== 0))
    for (let i = 0; i < 2; i++) add(tile);
  for (const tile of b.ramps) add(tile);
  // Directly in front of and behind scenery: on the path beside it, leaning towards it, and on its tile.
  for (const { tile, edge } of b.walls) {
    add(
      [tile[0] + DIR_DX[edge]!, tile[1] + DIR_DY[edge]!],
      GuestState.Wandering,
      -1,
      (edge + 2) & 3,
    );
  }
  for (const tree of b.trees.slice(0, 8)) {
    for (let d = 0; d < 4; d++) {
      const side: Tile = [tree[0] + DIR_DX[d]!, tree[1] + DIR_DY[d]!];
      if (b.hasPath(side[0], side[1])) {
        add(side, GuestState.Wandering, -1, (d + 2) & 3);
        break;
      }
    }
  }
  for (const tree of b.trees.slice(0, 3)) add(tree);
  const walkable = b.pathTiles((f) => (f & PathFlag.Queue) === 0);
  while (w.guests.count < total) add(b.pick(walkable));
}

function placeStaffAndLitter(b: ParkBuilder): void {
  const w = b.sim.world;
  const walkable = b.pathTiles((f) => (f & PathFlag.Queue) === 0);
  for (let kind = 0; kind < 4; kind++)
    b.sim.enqueue({ type: 'spawnStaff', count: 1 + b.rng.int(2), kind });
  b.sim.applyPendingCommands();
  const s = w.staff.cols;
  for (let slot = 0; slot < w.staff.count; slot++) {
    const [tx, ty] = b.pick(walkable);
    s.x[slot] = tx * TILE_UNITS + 24 + b.rng.int(TILE_UNITS - 48);
    s.y[slot] = ty * TILE_UNITS + 24 + b.rng.int(TILE_UNITS - 48);
    s.z[slot] = w.map.heightAt(s.x[slot]!, s.y[slot]!);
    s.targetX[slot] = tx + b.pick([-1, 0, 1]);
    s.targetY[slot] = ty;
  }
  const l = w.litter.cols;
  for (let i = 0; i < 12; i++) {
    const [tx, ty] = b.pick(walkable);
    const before = w.litter.count;
    if (!dropLitter(w, tx, ty, b.rng.int(3) === 0 ? LitterKind.Vomit : LitterKind.Trash)) continue;
    if (w.litter.count === before) continue;
    const slot = w.litter.count - 1;
    l.x[slot] = tx * TILE_UNITS + 32 + b.rng.int(TILE_UNITS - 64);
    l.y[slot] = ty * TILE_UNITS + 32 + b.rng.int(TILE_UNITS - 64);
    l.z[slot] = w.map.heightAt(l.x[slot]!, l.y[slot]!);
  }
  if (w.litter.count === 0) throw new Error('occlusion fuzz: no litter could be dropped');
}

/**
 * Gives up the park's land beyond the middle of the coaster, so the boundary fence and the land
 * overlay cross track, supports and paths: unowned tiles, some offered as land and some as
 * construction rights.
 */
function cedeLand(b: ParkBuilder): void {
  const w = b.sim.world;
  const xs = b.coasterCells.map(([x]) => x);
  const middle = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
  const { width, height } = w.map;
  for (let y = 0; y < height; y++)
    for (let x = middle + 1; x < width; x++) {
      const at = y * width + x;
      if (!(w.map.ownership[at]! & OWNED)) continue;
      const offer = (x * 7 + y * 3) % 5;
      w.map.ownership[at] = offer < 2 ? SALE_LAND : offer < 3 ? SALE_RIGHTS : 0;
    }
}

function publish(b: ParkBuilder): FuzzPark {
  const w = b.sim.world;
  cedeLand(b);
  const { width, height } = w.map;
  const words = Math.ceil((Math.ceil(width / 4) * Math.ceil(height / 4)) / 32);
  const staff = 64;
  const snapshot = createSnapshot({
    guests: 256,
    staff,
    vehicles: 64,
    litter: 256,
    rides: 64,
    mapTiles: width * height,
    patrolWordsPerArea: words,
    patrolAreas: staff * words,
  });
  writeSnapshot(w, snapshot);
  const map: MapData = {
    ...extractMapData(w.map),
    entranceX: w.park.entranceX,
    entranceY: w.park.entranceY,
  };
  const [fx, fy] = b.p(16, 16);
  const landmark = ([x, y]: Tile): Landmark => ({
    x: x + 0.5,
    y: y + 0.5,
    z: w.map.heightAt((x + 0.5) * TILE_UNITS, (y + 0.5) * TILE_UNITS) / Z_STEP,
  });
  return {
    map,
    snapshot,
    focus: { x: fx, y: fy, z: w.map.heightAt(fx * TILE_UNITS, fy * TILE_UNITS) / Z_STEP },
    landmarks: { gate: landmark(b.gate), boarding: b.boarding.map(landmark) },
  };
}

export function buildFuzzPark(seed: number, options?: { size?: number }): FuzzPark {
  const size = options?.size ?? LAYOUT_SIZE;
  if (!Number.isInteger(size) || size < LAYOUT_SIZE)
    throw new Error(`occlusion fuzz: size must be an integer >= ${LAYOUT_SIZE}`);
  const b = new ParkBuilder(seed, size, (size - LAYOUT_SIZE) >> 1);
  buildTerrain(b);
  buildPaths(b);
  const coaster = buildRides(b);
  buildAdditions(b);
  buildBumps(b);
  buildScenery(b);
  runCoasterTest(b, coaster);
  placeGuests(b);
  placeStaffAndLitter(b);
  return publish(b);
}
