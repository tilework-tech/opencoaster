import { TRACK_STEPS_PER_LEVEL } from '../../src/sim/core/constants';
import { Simulation } from '../../src/sim/core/simulation';
import { PIECES, pieceByName } from '../../src/sim/track/catalog';
import type { SceneryItem } from '../../src/sim/map/scenery';
import { SCENERY_RADIUS_TILES } from '../../src/sim/vehicles/vehicle-ratings';
import { deserialize, serialize } from '../../src/save/save';
import { getConstructionCursor, rotateTile } from '../../src/sim/track/construction';
import { RIDE_CATALOG, RideType } from '../../src/sim/rides/ride-types';
import {
  DIR_DX,
  DIR_DY,
  ElementType,
  PATH_BOARDING_MARKS,
  PathFlag,
  SLOPE_DIR_SHIFT,
} from '../../src/sim/map/tile-map';
import { PathAddition, PathResult, planPathPlacement } from '../../src/sim/map/paths';
import { COASTER_TEMPLATES, mirrored } from './coasters';
import { RideState } from '../../src/sim/rides/ride-store';
import { validateRidePlacement } from '../../src/sim/rides/ride-footprint';
import { RideResult } from '../../src/sim/rides/ride-results';
import { PREBUILT_TYPES } from '../../src/sim/scenario/scenario-prebuilt';
import { rideFrontage } from '../../src/sim/scenario/park-grid';
import type { ParkGrid } from '../../src/sim/scenario/park-grid';

/**
 * A coaster circuit pinned to the map: the station tile, the heading of its first piece, the
 * station's height level, and whether the template is mirrored so it turns the other way.
 */
export interface CoasterSite {
  template: string;
  x: number;
  y: number;
  dir: 0 | 1 | 2 | 3;
  mirror: boolean;
  /** Station height level; defaults to the ground under the station. */
  level?: number;
}

export interface SiteBuild {
  rideId: number;
  closed: boolean;
  /** Tiles beside the station for the entrance and the exit. */
  entrance: [number, number];
  exit: [number, number];
  /** The tiles in front of the entrance and the exit, where their paths begin. */
  entranceFront: [number, number];
  exitFront: [number, number];
  level: number;
}

/**
 * Creates a wooden coaster at `site` and lays its template through player commands. The circuit
 * may climb over slopes on supports or run into the ground as a tunnel; a piece the game refuses
 * leaves the circuit open, which `closed` reports.
 */
export function buildCircuit(sim: Simulation, site: CoasterSite): SiteBuild {
  const world = sim.world;
  const map = world.map;
  const template = COASTER_TEMPLATES[site.template];
  const pieces = site.mirror ? mirrored(template.pieces) : template.pieces;
  const level = site.level ?? map.heights[map.index(site.x, site.y)];
  const sigma = site.mirror ? -1 : 1;
  const at = (i: number, j: number): [number, number] => {
    const [rx, ry] = rotateTile(i, j, site.dir);
    return [site.x + rx, site.y + ry];
  };
  sim.enqueue({ type: 'createRide', rideType: RideType.WoodenCoaster, x: site.x, y: site.y });
  sim.step();
  const rideId = world.rides.slotToId[world.rides.count - 1];
  for (const [name, mode] of pieces) {
    const cursor = getConstructionCursor(world, rideId);
    const from = cursor.hasTrack
      ? cursor
      : { x: site.x, y: site.y, z: level * TRACK_STEPS_PER_LEVEL, dir: site.dir };
    sim.enqueue({
      type: 'placeTrack',
      rideId,
      pieceType: pieceByName(name)!.id,
      x: from.x,
      y: from.y,
      z: from.z,
      dir: from.dir,
      mode,
    });
    sim.step();
  }
  return {
    rideId,
    closed: world.track.closed[rideId] === 1,
    entrance: at(0, -sigma),
    exit: at(0, sigma),
    entranceFront: at(0, -2 * sigma),
    exitFront: at(0, 2 * sigma),
    level,
  };
}

/**
 * Lays a footpath along `tiles` (each edge-adjacent to the last), starting level with a path at
 * `startLevel`. Each piece sits on or above its ground: the route keeps to the ground where it can
 * and otherwise climbs, descends or bridges one level per tile, as a player's raised path would.
 * Returns the levels of the pieces, or null when the route cannot start at `startLevel`.
 */
export function layRoute(
  sim: Simulation,
  tiles: ReadonlyArray<readonly [number, number]>,
  startLevel: number,
  queue = false,
): number[] | null {
  const map = sim.world.map;
  const top = tiles.map(([x, y]) => {
    const i = map.index(x, y);
    return Math.max(map.heights[i] + (map.slope[i] !== 0 ? 1 : 0), map.waterLevel[i]);
  });
  const n = tiles.length;
  const floor = Array.from({ length: n + 1 }, (_, k) =>
    Math.max(k > 0 ? top[k - 1] : 0, k < n ? top[k] : 0),
  );
  floor[0] = Math.max(floor[0], startLevel);
  const step = (k: number): number => {
    const [x, y] = tiles[k];
    const [px, py] = k > 0 ? tiles[k - 1] : [x - (tiles[1][0] - x), y - (tiles[1][1] - y)];
    return [0, 1, 2, 3].find((d) => DIR_DX[d] === x - px && DIR_DY[d] === y - py)!;
  };
  // A ramp only joins along its slope, so a tile where the route turns stays level.
  const corner = tiles.map((_, k) => k + 1 < n && step(k + 1) !== step(k));
  let edge = floor;
  for (let changed = true; changed;) {
    edge = floor.map((_, k) => Math.max(...floor.map((f, j) => f - Math.abs(k - j))));
    changed = false;
    for (let k = 0; k < n; k++) {
      if (!corner[k] || edge[k] === edge[k + 1]) continue;
      const level = Math.max(edge[k], edge[k + 1]);
      floor[k] = Math.max(floor[k], level);
      floor[k + 1] = Math.max(floor[k + 1], level);
      changed = true;
    }
  }
  if (edge[0] !== startLevel) return null;
  const levels: number[] = [];
  for (let k = 0; k < n; k++) {
    const [x, y] = tiles[k];
    const forward = step(k);
    const rise = edge[k + 1] - edge[k];
    const z = Math.min(edge[k], edge[k + 1]);
    const slope = rise > 0 ? forward : rise < 0 ? (forward + 2) % 4 : -1;
    sim.enqueue({ type: 'placePath', x, y, z, slope, queue });
    if (!queue && slope < 0 && k % 3 === 2)
      sim.enqueue({ type: 'setPathAddition', x, y, addition: PathAddition.Bin });
    levels.push(z);
  }
  sim.step();
  return levels;
}

/**
 * Lays the shortest ground-level footpath from `start` (included) to beside any tile `goal`
 * accepts, through tiles where the game would accept a path piece. Returns the tiles laid,
 * `start` first, or null.
 */
export function connectOnGround(
  sim: Simulation,
  start: readonly [number, number],
  goal: (tile: number) => boolean,
  queue = false,
): Array<[number, number]> | null {
  const map = sim.world.map;
  const origin = map.index(start[0], start[1]);
  /** Level of the piece's edge on `side`, or -1 where a ramp's flank cannot join. */
  const edge = (tile: number, side: number): number => {
    let z: number;
    let rise: number;
    const existing = map.pathElement(tile, map.heights[tile]);
    if (existing >= 0) {
      z = map.elBase[existing];
      rise =
        map.elFlags[existing] & PathFlag.Sloped
          ? (map.elFlags[existing] & PathFlag.SlopeDir) >> SLOPE_DIR_SHIFT
          : -1;
    } else {
      const plan = planPathPlacement(map, { x: tile % map.width, y: Math.floor(tile / map.width) });
      if (plan.result !== PathResult.Ok || plan.existing >= 0) return -1;
      z = plan.z;
      rise = plan.dir;
    }
    if (rise < 0) return z;
    return side === rise ? z + 1 : side === ((rise + 2) & 3) ? z : -1;
  };
  const from = new Map<number, number>([[origin, -1]]);
  const frontier = [origin];
  for (let head = 0; head < frontier.length; head++) {
    const here = frontier[head];
    if (here !== origin && goal(here)) {
      const route: Array<[number, number]> = [];
      for (let t = from.get(here)!; t >= 0; t = from.get(t)!)
        route.push([t % map.width, Math.floor(t / map.width)]);
      route.reverse();
      for (const [x, y] of route) sim.enqueue({ type: 'placePath', x, y, queue });
      sim.step();
      return route;
    }
    if (here !== origin && map.pathElement(here, -1) >= 0) continue;
    for (let d = 0; d < 4; d++) {
      const n = map.neighbor(here, d);
      if (n < 0 || from.has(n)) continue;
      const out = edge(here, d);
      if (out < 0 || out !== edge(n, (d + 2) & 3)) continue;
      if (map.pathElement(n, -1) >= 0 && !goal(n)) continue;
      from.set(n, here);
      frontier.push(n);
    }
  }
  return null;
}

/** Edge-adjacent tiles through `points`, moving along x then y between each pair. */
export function waypoints(
  points: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  const out: Array<[number, number]> = [[points[0][0], points[0][1]]];
  for (let k = 1; k < points.length; k++) {
    let [x, y] = out[out.length - 1];
    const [tx, ty] = points[k];
    while (x !== tx) out.push([(x += Math.sign(tx - x)), y]);
    while (y !== ty) out.push([x, (y += Math.sign(ty - y))]);
  }
  return out;
}

/** Removes the small scenery (trees, rocks) on `tiles` through the normal removal command. */
export function clearScenery(
  sim: Simulation,
  tiles: ReadonlyArray<readonly [number, number]>,
): void {
  const map = sim.world.map;
  for (const [x, y] of tiles) {
    const i = map.index(x, y);
    for (let e = map.firstElement(i); e >= 0; e = map.nextElement(e))
      if (map.elType[e] === ElementType.SmallScenery) sim.enqueue({ type: 'removeScenery', x, y });
  }
  sim.step();
}

/**
 * True when tile `i` holds a flat footpath piece lying on its ground that is not a ride's entrance
 * or exit tile, so a new path or queue can join it from any side.
 */
export function flatGroundPath(sim: Simulation, i: number): boolean {
  const map = sim.world.map;
  const e = map.pathElement(i, map.heights[i]);
  return (
    e >= 0 &&
    !(map.elFlags[e] & PathFlag.Sloped) &&
    !map.isQueue(i) &&
    !(map.elData[e] & PATH_BOARDING_MARKS)
  );
}

export interface OpenedRide {
  rideId: number;
  /** Ride state after the build: `RideState.Open` when it opened. */
  state: number;
  excitement: number;
}

/**
 * Builds a coaster at `site`, lays its queue from the entrance and a path from the exit to tiles
 * `joins` accepts, and starts its test run. With `clear`, scenery on the entrance and exit tiles
 * is removed first. Returns the ride id, or null when the circuit does not close or a path cannot
 * be laid.
 */
export function startCoaster(
  sim: Simulation,
  site: CoasterSite,
  joins: (tile: number) => boolean,
  clear = true,
  decorate?: { item: SceneryItem; count: number },
): number | null {
  const world = sim.world;
  const c = buildCircuit(sim, site);
  const abandon = (): null => {
    sim.enqueue({ type: 'demolishRide', rideId: c.rideId });
    sim.step();
    return null;
  };
  if (!c.closed) return abandon();
  const taken = (t: readonly [number, number]) =>
    world.map.pathElement(world.map.index(t[0], t[1]), -1) >= 0;
  if ([c.entrance, c.exit, c.entranceFront, c.exitFront].some(taken)) return abandon();
  if (clear) clearScenery(sim, [c.entrance, c.exit, c.entranceFront, c.exitFront]);
  sim.enqueue({ type: 'placePath', x: c.entrance[0], y: c.entrance[1], queue: true });
  sim.enqueue({ type: 'placePath', x: c.exit[0], y: c.exit[1] });
  sim.step();
  const exitTile = world.map.index(c.exit[0], c.exit[1]);
  if (!connectOnGround(sim, c.entranceFront, (t) => t !== exitTile && joins(t), true))
    return abandon();
  if (!connectOnGround(sim, c.exitFront, joins)) return abandon();
  sim.enqueue({ type: 'placeRideEntrance', rideId: c.rideId, x: c.entrance[0], y: c.entrance[1] });
  sim.enqueue({ type: 'placeRideExit', rideId: c.rideId, x: c.exit[0], y: c.exit[1] });
  sim.step();
  if (decorate) plantAround(sim, site, decorate.item, decorate.count);
  sim.enqueue({ type: 'setRideStatus', rideId: c.rideId, status: 'test' });
  sim.step();
  return c.rideId;
}

/**
 * Plants up to `count` scenery items on free tiles near the station, nearest first, the way a
 * player decorates a coaster: scenery near the station lifts its excitement.
 */
export function plantAround(
  sim: Simulation,
  site: CoasterSite,
  item: SceneryItem,
  count: number,
): void {
  const map = sim.world.map;
  const spots: Array<[number, number, number]> = [];
  for (let dy = -SCENERY_RADIUS_TILES; dy <= SCENERY_RADIUS_TILES; dy++)
    for (let dx = -SCENERY_RADIUS_TILES; dx <= SCENERY_RADIUS_TILES; dx++) {
      const x = site.x + dx;
      const y = site.y + dy;
      if (!map.inBounds(x, y) || map.firstElement(map.index(x, y)) >= 0) continue;
      spots.push([dx * dx + dy * dy, x, y]);
    }
  spots.sort((a, b) => a[0] - b[0]);
  for (const [, x, y] of spots.slice(0, count)) sim.enqueue({ type: 'placeScenery', x, y, item });
  sim.step();
}

/** `startCoaster`, then waits for the test run and opens the coaster. */
export function openCoaster(
  sim: Simulation,
  site: CoasterSite,
  joins: (tile: number) => boolean,
  clear = true,
): OpenedRide | null {
  const world = sim.world;
  const rideId = startCoaster(sim, site, joins, clear);
  if (rideId === null) return null;
  const slot = () => world.rides.idToSlot[rideId];
  for (let t = 0; t < 12_000 && world.rides.cols.tested[slot()] !== 1; t++) sim.step();
  for (let t = 0; t < 4_000 && world.rides.cols.state[slot()] !== RideState.Open; t++) {
    if (t % 50 === 0) sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    sim.step();
  }
  return {
    rideId,
    state: world.rides.cols.state[slot()],
    excitement: world.rides.cols.excitement[slot()],
  };
}

/** Tile rectangle a coaster at `site` and its station paths can cover, with a margin. */
export function siteBounds(
  site: CoasterSite,
  margin = 2,
): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const t = COASTER_TEMPLATES[site.template];
  const [y0, y1] = site.mirror ? [-t.maxY, 0] : [0, t.maxY];
  const corners = [
    [t.minX, y0 - 2],
    [t.maxX, y0 - 2],
    [t.minX, y1 + 2],
    [t.maxX, y1 + 2],
  ].map(([i, j]) => rotateTile(i, j, site.dir));
  const xs = corners.map(([x]) => site.x + x);
  const ys = corners.map(([, y]) => site.y + y);
  const x = Math.min(...xs) - margin;
  const y = Math.min(...ys) - margin;
  return {
    x,
    y,
    width: Math.max(...xs) + margin - x + 1,
    height: Math.max(...ys) + margin - y + 1,
  };
}

/**
 * Builds and opens a flat ride or stall beside a spine path the caller already laid, at
 * (`row`, `lateral`) on `grid`, the way the scripted builder places rides along its spine.
 */
export function openFlatRide(
  sim: Simulation,
  grid: ParkGrid,
  row: number,
  lateral: number,
  name: string,
): OpenedRide | null {
  const world = sim.world;
  const type = PREBUILT_TYPES[name];
  const frontage = rideFrontage(grid, row, lateral, RIDE_CATALOG[type].footprint);
  if (validateRidePlacement(world, type, ...frontage.ride, frontage.dir) !== RideResult.Ok)
    return null;
  const service =
    RIDE_CATALOG[type].category === 'stall' || RIDE_CATALOG[type].category === 'facility';
  for (const [x, y] of [...frontage.queue, ...frontage.exitPath]) {
    const queue = frontage.queue.some(([qx, qy]) => qx === x && qy === y) && !service;
    sim.enqueue({ type: 'placePath', x, y, queue });
    sim.enqueue({ type: 'setPathAddition', x, y, addition: PathAddition.Bin });
  }
  sim.enqueue({
    type: 'createRide',
    rideType: type,
    x: frontage.ride[0],
    y: frontage.ride[1],
    dir: frontage.dir,
  });
  sim.step();
  const rideId = world.rides.slotToId[world.rides.count - 1];
  sim.enqueue({
    type: 'placeRideEntrance',
    rideId,
    x: frontage.entrance[0],
    y: frontage.entrance[1],
  });
  if (!service)
    sim.enqueue({ type: 'placeRideExit', rideId, x: frontage.exit[0], y: frontage.exit[1] });
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
  sim.step();
  const slot = world.rides.idToSlot[rideId];
  return {
    rideId,
    state: world.rides.cols.state[slot],
    excitement: world.rides.cols.excitement[slot],
  };
}

/**
 * Tiles a coaster at `site` needs free of scenery: its track footprint and the tiles beside the
 * station for the entrance and exit. Found by building it on a copy of the park with the
 * surrounding scenery cleared, so the real park only loses the trees the track actually needs.
 */
export function circuitTiles(sim: Simulation, site: CoasterSite): Array<[number, number]> {
  const copy = new Simulation(deserialize(serialize(sim.world)));
  const map = copy.world.map;
  const area = siteBounds(site);
  for (let y = area.y; y < area.y + area.height; y++)
    for (let x = area.x; x < area.x + area.width; x++) {
      if (!map.inBounds(x, y)) continue;
      const i = map.index(x, y);
      for (let e = map.firstElement(i); e >= 0;) {
        const next = map.nextElement(e);
        if (map.elType[e] === ElementType.SmallScenery) map.removeElement(i, e);
        e = next;
      }
    }
  const c = buildCircuit(copy, site);
  const tiles = new Map<number, [number, number]>();
  const add = (x: number, y: number) => tiles.set(map.index(x, y), [x, y]);
  const t = copy.world.track;
  const cols = t.pieces.cols;
  for (let slot = 0; slot < t.pieces.count; slot++) {
    if (cols.rideId[slot] !== c.rideId) continue;
    for (const cell of PIECES[cols.pieceType[slot]].footprint) {
      const [rx, ry] = rotateTile(cell.i, cell.j, cols.dir[slot] as 0 | 1 | 2 | 3);
      add(cols.x[slot] + rx, cols.y[slot] + ry);
    }
  }
  for (const tile of [c.entrance, c.exit, c.entranceFront, c.exitFront]) add(...tile);
  return [...tiles.values()];
}
