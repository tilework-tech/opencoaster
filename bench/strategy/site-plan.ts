import {
  LAND_PRICE_CENTS,
  PATH_COST_CENTS,
  RIGHTS_PRICE_CENTS,
  SALE_LAND,
  SALE_RIGHTS,
} from '../../src/sim/map/tile-map';
import { RIDE_CATALOG } from '../../src/sim/rides/ride-types';
import { PathAddition } from '../../src/sim/map/paths';
import { SCENERY_CATALOG } from '../../src/sim/map/scenery';
import type { SceneryItem } from '../../src/sim/map/scenery';
import { ParkGrid } from '../../src/sim/scenario/park-grid';
import { PREBUILT_TYPES } from '../../src/sim/scenario/scenario-prebuilt';
import type { EntranceSide } from '../../src/sim/scenario/scenario';
import type { ParkBuilder } from './builder';
import { StaffKind } from './builder';
import type { Strategy, StrategyFactory } from './run';
import { TICKS_PER_MONTH } from './run';
import {
  circuitTiles,
  clearScenery,
  flatGroundPath,
  layRoute,
  openFlatRide,
  siteBounds,
  startCoaster,
  waypoints,
} from './site';
import type { CoasterSite } from './site';

/** Loans move in $1,000 steps. */
const LOAN_STEP_CENTS = 100_000;

/** One build decision of a site plan; see `sitePlanStrategy`. */
export type SiteStep =
  /** A flat ride or stall on the builder's spine from the gate. */
  | { kind: 'item'; name: string }
  /**
   * A footpath through `points`, starting beside `from` (a tile already holding a flat path) or
   * the end of the gate spine, clearing scenery on the way when the park allows it.
   */
  | { kind: 'route'; points: Array<[number, number]>; clear: boolean; from?: [number, number] }
  /** A coaster at a fixed site, buying the land and rights under it and clearing its track tiles first. */
  | { kind: 'coaster'; site: CoasterSite }
  /**
   * A flat ride or stall beside a spine path laid along `grid` (gate x, gate y, side) for rows
   * 0..`row`, the way the builder lays rides along its own spine.
   */
  | {
      kind: 'flat';
      grid: [number, number, EntranceSide];
      row: number;
      lateral: number;
      name: string;
    }
  /** Buys land or rights in a rectangle. */
  | { kind: 'buy'; x: number; y: number; width: number; height: number; rights: boolean }
  /** Clears scenery from the owned part of a rectangle with the Clear tool. */
  | { kind: 'clear'; x: number; y: number; width: number; height: number };

export interface SitePlan {
  steps: SiteStep[];
  /** Cash kept back for wages and running costs. */
  reserveCents: number;
  prices: Record<string, number>;
  /** One handyman per this many rides and stalls (rounded up), at least one. */
  itemsPerHandyman: number;
  /** One mechanic per this many attractions. */
  attractionsPerMechanic: number;
  /** Scenery planted round each coaster station before its test run. */
  decorate?: { item: SceneryItem; count: number };
  /** Repay the loan once cash exceeds it by this much. */
  repayAboveCents?: number;
  /** Borrow up to the limit when a step is short of cash. */
  borrow?: boolean;
  /**
   * Patrol areas, inclusive tile rectangles [x0, y0, x1, y1], dealt to handymen in turn so a
   * spread-out park is swept everywhere rather than only around the gate.
   */
  patrols?: Array<[number, number, number, number]>;
}

/**
 * Plays a park through a fixed list of placements chosen for its terrain: each step is built, in
 * order, as soon as the park can afford it on top of its reserve. Every placement goes through
 * ordinary player commands, so the game's ownership, terrain and scenario rules apply.
 */
export function sitePlanStrategy(plan: SitePlan): StrategyFactory {
  return () => {
    let next = 0;
    let nextDecision = 0;
    let nextAdvance = 0;
    const patrolled = new Set<number>();
    const strategy: Strategy = {
      step(b) {
        const tick = b.tick;
        if (tick === 0) b.prices = plan.prices;
        if (tick >= nextAdvance) {
          nextAdvance = tick + 64;
          b.advance();
        }
        if (tick < nextDecision) return;
        nextDecision = tick + TICKS_PER_MONTH / 8;
        while (next < plan.steps.length) {
          const step = plan.steps[next];
          const cost = costOf(b, step, plan);
          const l = b.sim.world.economy;
          if (plan.borrow && l.cash < cost + plan.reserveCents && l.loan < l.maxLoan) {
            const short = cost + plan.reserveCents - l.cash;
            b.borrow(
              Math.min(l.maxLoan - l.loan, Math.ceil(short / LOAN_STEP_CENTS) * LOAN_STEP_CENTS),
            );
            b.sim.step();
          }
          if (l.cash < cost + plan.reserveCents) break;
          perform(b, step, plan);
          next++;
        }
        const items = b.sim.world.rides.count;
        b.staffTo(StaffKind.Handyman, Math.max(1, Math.ceil(items / plan.itemsPerHandyman)));
        b.staffTo(StaffKind.Mechanic, Math.ceil(b.attractions() / plan.attractionsPerMechanic));
        if (plan.patrols) assignPatrols(b, plan.patrols, patrolled);
        const l = b.sim.world.economy;
        if (
          plan.repayAboveCents !== undefined &&
          l.loan > 0 &&
          l.cash > l.loan + plan.repayAboveCents
        )
          b.repay(l.loan);
      },
    };
    return strategy;
  };
}

function assignPatrols(
  b: ParkBuilder,
  areas: Array<[number, number, number, number]>,
  patrolled: Set<number>,
): void {
  const staff = b.sim.world.staff;
  for (let slot = 0; slot < staff.count; slot++) {
    const id = staff.slotToId[slot];
    if (staff.cols.kind[slot] !== StaffKind.Handyman || patrolled.has(id)) continue;
    const [x0, y0, x1, y1] = areas[patrolled.size % areas.length];
    patrolled.add(id);
    for (let y = y0; y <= y1; y += 4)
      for (let x = x0; x <= x1; x += 4)
        b.sim.enqueue({ type: 'setStaffPatrolTile', staffId: id, x, y, enabled: true });
  }
}

function saleCost(
  b: ParkBuilder,
  r: { x: number; y: number; width: number; height: number },
): number {
  const m = b.sim.world.map;
  let cents = 0;
  for (let y = Math.max(0, r.y); y < Math.min(m.height, r.y + r.height); y++)
    for (let x = Math.max(0, r.x); x < Math.min(m.width, r.x + r.width); x++) {
      const o = m.ownership[m.index(x, y)];
      if (o & SALE_LAND) cents += LAND_PRICE_CENTS;
      else if (o & SALE_RIGHTS) cents += RIGHTS_PRICE_CENTS;
    }
  return cents;
}

function costOf(b: ParkBuilder, step: SiteStep, plan: SitePlan): number {
  switch (step.kind) {
    case 'item':
      return b.costOf(step.name);
    case 'route':
      return waypoints(step.points).length * PATH_COST_CENTS * 3;
    case 'coaster': {
      const area = siteBounds(step.site);
      const decor = plan.decorate
        ? plan.decorate.count * SCENERY_CATALOG[plan.decorate.item].priceCents
        : 0;
      return 350_000 + saleCost(b, area) + area.width * area.height * 1_000 + decor;
    }
    case 'flat':
      return RIDE_CATALOG[PREBUILT_TYPES[step.name]].cost + (step.row + 12) * PATH_COST_CENTS;
    case 'buy':
      return saleCost(b, step);
    case 'clear':
      return step.width * step.height * 2_000;
  }
}

function spineEnd(b: ParkBuilder): [number, number] {
  const m = b.sim.world.map;
  let row = 0;
  while (m.pathElement(m.index(...b.grid.tile(row + 1, 0)), -1) >= 0) row++;
  return b.grid.tile(row, 0);
}

function perform(b: ParkBuilder, step: SiteStep, plan: SitePlan): void {
  const sim = b.sim;
  const m = sim.world.map;
  switch (step.kind) {
    case 'item':
      b.build(step.name);
      return;
    case 'route': {
      const start = step.from ?? spineEnd(b);
      const tiles = waypoints([start, ...step.points]).slice(1);
      if (step.clear) clearScenery(sim, tiles);
      layRoute(sim, tiles, m.heights[m.index(start[0], start[1])]);
      return;
    }
    case 'coaster': {
      const area = siteBounds(step.site);
      sim.enqueue({ type: 'buyLand', ...area, rights: false });
      sim.enqueue({ type: 'buyLand', ...area, rights: true });
      sim.step();
      clearScenery(sim, circuitTiles(sim, step.site));
      const rideId = startCoaster(
        sim,
        step.site,
        (t) => flatGroundPath(sim, t),
        true,
        plan.decorate,
      );
      if (rideId === null) return;
      if (b.prices.coaster !== undefined)
        sim.enqueue({ type: 'setRidePrice', rideId, priceCents: b.prices.coaster });
      b.watch(rideId);
      return;
    }
    case 'flat': {
      const grid = new ParkGrid(...step.grid);
      for (let row = 0; row <= step.row; row++) {
        const [x, y] = grid.tile(row, 0);
        if (m.pathElement(m.index(x, y), -1) >= 0) continue;
        sim.enqueue({ type: 'placePath', x, y });
        if (row % 2 === 0)
          sim.enqueue({ type: 'setPathAddition', x, y, addition: PathAddition.Bin });
      }
      sim.step();
      const ride = openFlatRide(sim, grid, step.row, step.lateral, step.name);
      const price = ride ? b.prices[step.name] : undefined;
      if (ride && price !== undefined)
        sim.enqueue({ type: 'setRidePrice', rideId: ride.rideId, priceCents: price });
      return;
    }
    case 'buy':
      sim.enqueue({ type: 'buyLand', ...step });
      sim.step();
      return;
    case 'clear':
      sim.enqueue({
        type: 'clearScenery',
        x: step.x,
        y: step.y,
        width: step.width,
        height: step.height,
      });
      sim.step();
      return;
  }
}
