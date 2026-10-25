import { Z_STEP } from '../../src/sim/core/constants';
import type { Simulation } from '../../src/sim/core/simulation';
import { PathAddition } from '../../src/sim/map/paths';
import { PATH_COST_CENTS } from '../../src/sim/map/tile-map';
import { PIECES, pieceByName } from '../../src/sim/track/catalog';
import { getConstructionCursor, rotateTile } from '../../src/sim/track/construction';
import { COASTER_TEMPLATES, mirrored } from './coasters';
import type { CoasterTemplate } from './coasters';
import { RideState } from '../../src/sim/rides/ride-store';
import { RIDE_CATALOG, RideType } from '../../src/sim/rides/ride-types';
import { PREBUILT_TYPES } from '../../src/sim/scenario/scenario-prebuilt';
import { ParkGrid, rideFrontage } from '../../src/sim/scenario/park-grid';
import type { ScenarioDef } from '../../src/sim/scenario/scenario';
import { StaffKind } from '../../src/sim/staff/staff-store';

/** Lateral distance of a flat ride from the spine, and of a stall. */
export const RIDE_REACH = 6;
export const STALL_REACH = 2;

const STALLS = new Set<string>(['foodStall', 'drinkStall', 'informationKiosk', 'toilets']);

/** Ground room reserved for one coaster: its station, queue, connector path and circuit. */
export interface CoasterPad {
  template: CoasterTemplate;
  side: number;
  /** Row of the connector path joining the spine to the queue. */
  connectorRow: number;
  /** Lateral distance of the station from the spine. */
  distance: number;
  lastRow: number;
  built: boolean;
}

export interface Slot {
  row: number;
  lateral: number;
}

/**
 * Builds a park through player commands on the grid anchored at the gate: a spine path inward,
 * with one flat ride or stall per row and side, each with its queue, entrance and exit. A
 * strategy asks for items by name; the builder finds the next free slot nearest the gate.
 */
export class ParkBuilder {
  readonly grid: ParkGrid;
  private readonly occupied = new Set<string>();
  private spineRow: number;
  /** Rows reserved on one side for a coaster pad, as [first, last]. */
  private readonly reserved: Array<{ side: number; first: number; last: number }> = [];
  readonly maxRow: number;
  readonly rideIds: number[] = [];
  readonly pads: CoasterPad[] = [];
  /** Ticket price in cents per ride name when the park charges per ride; coasters use `coaster`. */
  prices: Record<string, number> = {};
  private readonly testing = new Map<number, number>();

  constructor(
    readonly sim: Simulation,
    readonly def: ScenarioDef,
  ) {
    const world = sim.world;
    const side = def.entrance?.side ?? 'south';
    this.grid = new ParkGrid(world.park.entranceX, world.park.entranceY, side);
    this.spineRow = def.entrance?.length ?? 4;
    this.maxRow = (def.terrain?.buildLength ?? 30) - 1;
    for (const p of def.prebuilt ?? []) {
      this.occupy(p.row, Math.sign(p.lateral));
      this.spineRow = Math.max(this.spineRow, p.row);
    }
  }

  get tick(): number {
    return this.sim.world.tick;
  }

  get cash(): number {
    return this.sim.world.economy.cash;
  }

  private key(row: number, side: number): string {
    return `${row}:${side}`;
  }

  private occupy(row: number, side: number): void {
    this.occupied.add(this.key(row - 1, side));
    this.occupied.add(this.key(row, side));
    this.occupied.add(this.key(row + 1, side));
  }

  reserve(side: number, first: number, last: number): void {
    this.reserved.push({ side, first, last });
  }

  private free(row: number, side: number): boolean {
    if (this.occupied.has(this.key(row, side))) return false;
    return !this.reserved.some((r) => r.side === side && row + 1 >= r.first && row - 1 <= r.last);
  }

  /** Free slots nearest the gate first, alternating sides. */
  nextSlot(): Slot | null {
    for (let row = 2; row <= this.maxRow; row += 1) {
      for (const side of [1, -1]) {
        if (this.free(row, side)) return { row, lateral: side };
      }
    }
    return null;
  }

  private extendSpine(row: number): void {
    for (let r = this.spineRow + 1; r <= row; r++) {
      const [x, y] = this.grid.tile(r, 0);
      this.sim.enqueue({ type: 'placePath', x, y });
      if (r % 2 === 0)
        this.sim.enqueue({ type: 'setPathAddition', x, y, addition: PathAddition.Bin });
    }
    this.spineRow = Math.max(this.spineRow, row);
  }

  /** Cost in cents of one ride or stall including its paths. */
  costOf(name: string): number {
    const reach = STALLS.has(name) ? STALL_REACH : RIDE_REACH;
    return RIDE_CATALOG[PREBUILT_TYPES[name]].cost + (2 * reach + 2) * PATH_COST_CENTS;
  }

  /** Places and opens one flat ride or stall; returns its id, or -1 with nothing built. */
  build(name: string, reserveCents = 0): number {
    const slot = this.nextSlot();
    if (!slot || this.cash < this.costOf(name) + reserveCents) return -1;
    const reach = STALLS.has(name) ? STALL_REACH : RIDE_REACH;
    const lateral = slot.lateral * reach;
    this.extendSpine(slot.row);
    const frontage = rideFrontage(this.grid, slot.row, lateral);
    const serviceRide = STALLS.has(name);
    for (const [x, y] of frontage.queue) {
      this.sim.enqueue({ type: 'placePath', x, y, queue: !serviceRide });
      this.sim.enqueue({ type: 'setPathAddition', x, y, addition: PathAddition.Bin });
    }
    for (const [x, y] of frontage.exitPath) {
      this.sim.enqueue({ type: 'placePath', x, y });
      this.sim.enqueue({ type: 'setPathAddition', x, y, addition: PathAddition.Bin });
    }
    this.sim.enqueue({
      type: 'createRide',
      rideType: PREBUILT_TYPES[name],
      x: frontage.ride[0],
      y: frontage.ride[1],
    });
    this.sim.step();
    const world = this.sim.world;
    const rideId = world.rides.slotToId[world.rides.count - 1];
    this.sim.enqueue({
      type: 'placeRideEntrance',
      rideId,
      x: frontage.entrance[0],
      y: frontage.entrance[1],
    });
    if (!serviceRide)
      this.sim.enqueue({ type: 'placeRideExit', rideId, x: frontage.exit[0], y: frontage.exit[1] });
    this.sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    const price = this.prices[name];
    if (price !== undefined) this.sim.enqueue({ type: 'setRidePrice', rideId, priceCents: price });
    this.sim.step();
    this.occupy(slot.row, slot.lateral);
    this.rideIds.push(rideId);
    return rideId;
  }

  hire(kind: number, count = 1): void {
    for (let i = 0; i < count; i++) this.sim.enqueue({ type: 'hireStaff', kind });
  }

  staffCount(kind: number): number {
    const s = this.sim.world.staff;
    let n = 0;
    for (let i = 0; i < s.count; i++) if (s.cols.kind[i] === kind) n++;
    return n;
  }

  /** Raises staff of `kind` to `target`. */
  staffTo(kind: number, target: number): void {
    const have = this.staffCount(kind);
    if (target > have) this.hire(kind, target - have);
  }

  attractions(): number {
    const w = this.sim.world;
    let n = 0;
    for (let s = 0; s < w.rides.count; s++) {
      const def = RIDE_CATALOG[w.rides.cols.typeId[s] as RideType];
      if (
        def.category !== 'stall' &&
        def.category !== 'facility' &&
        w.rides.cols.state[s] === RideState.Open
      )
        n++;
    }
    return n;
  }

  borrow(cents: number): void {
    this.sim.enqueue({ type: 'economy', action: { type: 'borrow', cents } });
  }

  repay(cents: number): void {
    this.sim.enqueue({ type: 'economy', action: { type: 'repay', cents } });
  }

  /**
   * Reserves rows on `side` (+1 or -1) for a coaster of `templateName`, as far from the gate as
   * the apron allows, and returns the pad. Reserve before flat rides fill the rows.
   */
  planCoaster(templateName: string, side: number, firstRow?: number): CoasterPad {
    const template = COASTER_TEMPLATES[templateName];
    const used = this.pads.filter((p) => p.side === side).map((p) => p.connectorRow);
    const span = template.maxY + 4;
    const lastRow =
      firstRow === undefined ? Math.min(...used, this.maxRow + 1) - 1 : firstRow + span - 1;
    const connectorRow = lastRow - span + 1;
    const pad: CoasterPad = {
      template,
      side,
      connectorRow,
      distance: template.maxX + 3,
      lastRow,
      built: false,
    };
    this.reserve(side, connectorRow, lastRow);
    this.pads.push(pad);
    return pad;
  }

  /** Cost in cents of a coaster, track and paths, with margin. */
  coasterCost(pad: CoasterPad): number {
    return 300_000 + pad.template.pieces.length * 1_500 + (pad.distance + 20) * PATH_COST_CENTS;
  }

  /**
   * Builds the pad's coaster: spine extension, connector and queue, the circuit, entrance and
   * exit with a walkway round the circuit, then starts its test run. `advance` opens it when the
   * test finishes. Returns the ride id, or -1 when cash is short or the pad does not fit.
   */
  buildCoaster(pad: CoasterPad, reserveCents = 0): number {
    if (pad.built || this.cash < this.coasterCost(pad) + reserveCents) return -1;
    const sim = this.sim;
    const world = sim.world;
    const map = world.map;
    const { template, side } = pad;
    const across = this.grid.tile(0, 1);
    const origin = this.grid.tile(0, 0);
    const lateralStep: [number, number] = [across[0] - origin[0], across[1] - origin[1]];
    const toSpine: [number, number] = [-side * lateralStep[0], -side * lateralStep[1]];
    let dir = 0;
    while (rotateTile(1, 0, dir)[0] !== toSpine[0] || rotateTile(1, 0, dir)[1] !== toSpine[1])
      dir++;
    const e2 = rotateTile(0, 1, dir);
    const rowStep = this.grid.tile(1, 0);
    const inward: [number, number] = [rowStep[0] - origin[0], rowStep[1] - origin[1]];
    const tau = e2[0] * inward[0] + e2[1] * inward[1];
    const mirror = tau < 0;
    const pieces = mirror ? mirrored(template.pieces) : template.pieces;
    const sigma = mirror ? -1 : 1;
    const stationRow = pad.connectorRow + 2;
    const stationTile = this.grid.tile(stationRow, side * pad.distance);
    const stationIndex = map.index(stationTile[0], stationTile[1]);
    const groundZ = map.heights[stationIndex];

    this.extendSpine(pad.connectorRow);
    const worldOf = (i: number, j: number): [number, number] => {
      const [rx, ry] = rotateTile(i, j, dir);
      return [stationTile[0] + rx, stationTile[1] + ry];
    };
    for (let lateral = 1; lateral <= pad.distance + 4; lateral++) {
      const [x, y] = this.grid.tile(pad.connectorRow, side * lateral);
      sim.enqueue({ type: 'placePath', x, y });
    }
    for (let i = -4; i <= 0; i++) {
      const [x, y] = worldOf(i, -sigma);
      sim.enqueue({ type: 'placePath', x, y, queue: true });
      sim.enqueue({ type: 'setPathAddition', x, y, addition: PathAddition.Bin });
    }

    sim.enqueue({
      type: 'createRide',
      rideType: RideType.WoodenCoaster,
      x: stationTile[0],
      y: stationTile[1],
    });
    sim.step();
    const rideId = world.rides.slotToId[world.rides.count - 1];
    const ground = new Set<number>();
    for (const [name, mode] of pieces) {
      const cursor = getConstructionCursor(world, rideId);
      const at = cursor.hasTrack
        ? cursor
        : { x: stationTile[0], y: stationTile[1], z: groundZ, dir: dir as 0 | 1 | 2 | 3 };
      const def = pieceByName(name)!;
      sim.enqueue({
        type: 'placeTrack',
        rideId,
        pieceType: def.id,
        x: at.x,
        y: at.y,
        z: at.z,
        dir: at.dir,
        mode,
      });
      sim.step();
      for (const cell of PIECES[def.id].footprint) {
        const [rx, ry] = rotateTile(cell.i, cell.j, at.dir);
        if (
          at.z * Z_STEP + cell.zMin <= groundZ * Z_STEP &&
          at.z * Z_STEP + cell.zMax >= groundZ * Z_STEP
        ) {
          ground.add(map.index(at.x + rx, at.y + ry));
        }
      }
    }
    if (world.track.closed[rideId] !== 1)
      throw new Error(`coaster ${template.name} did not close on this map`);

    const entrance = worldOf(0, -sigma);
    const exit = worldOf(0, sigma);
    sim.enqueue({ type: 'placeRideEntrance', rideId, x: entrance[0], y: entrance[1] });
    sim.enqueue({ type: 'placeRideExit', rideId, x: exit[0], y: exit[1] });
    sim.step();

    for (const [x, y] of this.walkway(exit, pad, ground, entrance, worldOf, sigma)) {
      sim.enqueue({ type: 'placePath', x, y });
      sim.enqueue({ type: 'setPathAddition', x, y, addition: PathAddition.Bin });
    }
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    if (this.prices.coaster !== undefined) {
      sim.enqueue({ type: 'setRidePrice', rideId, priceCents: this.prices.coaster });
    }
    sim.step();
    this.testing.set(rideId, world.tick);
    pad.built = true;
    this.rideIds.push(rideId);
    return rideId;
  }

  /** Shortest walkable route from the coaster exit to its connector path, avoiding track at ground level and the queue. */
  private walkway(
    exit: [number, number],
    pad: CoasterPad,
    ground: Set<number>,
    entrance: [number, number],
    worldOf: (i: number, j: number) => [number, number],
    sigma: number,
  ): Array<[number, number]> {
    const map = this.sim.world.map;
    const blocked = new Set<number>(ground);
    blocked.add(map.index(entrance[0], entrance[1]));
    for (let i = -4; i <= 0; i++) {
      const [x, y] = worldOf(i, -sigma);
      blocked.add(map.index(x, y));
    }
    const goal = new Set<number>();
    for (let lateral = 1; lateral <= pad.distance + 4; lateral++) {
      const [x, y] = this.grid.tile(pad.connectorRow, pad.side * lateral);
      goal.add(map.index(x, y));
    }
    const start = map.index(exit[0], exit[1]);
    const from = new Map<number, number>([[start, -1]]);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const here = queue[head];
      if (goal.has(here)) {
        const route: Array<[number, number]> = [];
        for (let t = here; t >= 0; t = from.get(t) as number) {
          route.push([t % map.width, Math.floor(t / map.width)]);
        }
        return route;
      }
      for (let d = 0; d < 4; d++) {
        const n = map.neighbor(here, d);
        if (n < 0 || from.has(n) || blocked.has(n)) continue;
        if (!map.canBuild(n) || map.slope[n] !== 0 || map.waterLevel[n] !== 0) continue;
        if (map.firstElement(n) >= 0 && !goal.has(n)) continue;
        from.set(n, here);
        queue.push(n);
      }
    }
    throw new Error('no walkway from the coaster exit to its connector');
  }

  /** Opens each finished test run. Call regularly; it is cheap. */
  advance(): void {
    const world = this.sim.world;
    for (const [rideId, since] of this.testing) {
      if (!world.rides.isAlive(rideId)) {
        this.testing.delete(rideId);
        continue;
      }
      const slot = world.rides.idToSlot[rideId];
      if (world.rides.cols.tested[slot] === 1 && world.tick > since) {
        this.sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
        this.testing.delete(rideId);
      }
    }
  }
}

export { StaffKind, RideType };
