import { describe, expect, it } from 'vitest';
import { LedgerCategory } from '../economy/ledger';

import { Simulation } from './simulation';
import { PATH_COST_CENTS, LAND_PRICE_CENTS } from '../map/tile-map';
import { RIDE_CATALOG, RideType } from '../rides/ride-types';
import { PIECES, PieceId } from '../track/catalog';
import { prepareFlat } from '../integration/fixtures';

function simWithCash(cash: number): Simulation {
  const sim = new Simulation({ seed: 3, width: 16, height: 16 });
  prepareFlat(sim.world);
  sim.world.economy.cash = cash;
  return sim;
}

describe('construction is paid through the ledger', () => {
  it('charges paths, land, rides and track to their categories', () => {
    const sim = simWithCash(10_000_000);
    sim.world.map.ownership[sim.world.map.index(0, 0)] = 4;
    sim.enqueue({ type: 'placePath', x: 4, y: 4 });
    sim.enqueue({ type: 'buyLand', x: 0, y: 0, width: 1, height: 1, rights: false });
    sim.enqueue({ type: 'createRide', rideType: RideType.Twist, x: 8, y: 8 });
    sim.step();
    const m = sim.world.economy.monthlyTotals;
    expect(m[LedgerCategory.Landscaping]).toBe(-PATH_COST_CENTS);
    expect(m[LedgerCategory.Land]).toBe(-LAND_PRICE_CENTS);
    expect(m[LedgerCategory.RideConstruction]).toBe(-RIDE_CATALOG[RideType.Twist].cost);
    expect(sim.world.economy.cash).toBe(
      10_000_000 - PATH_COST_CENTS - LAND_PRICE_CENTS - RIDE_CATALOG[RideType.Twist].cost,
    );
  });

  it('refuses everything it cannot afford and leaves the world untouched', () => {
    const sim = simWithCash(PATH_COST_CENTS - 1);
    sim.world.map.ownership[sim.world.map.index(0, 0)] = 4;
    sim.enqueue({ type: 'placePath', x: 4, y: 4 });
    sim.enqueue({ type: 'buyLand', x: 0, y: 0, width: 1, height: 1, rights: false });
    sim.enqueue({ type: 'raiseLand', x: 6, y: 6, width: 2, height: 2 });
    sim.enqueue({ type: 'createRide', rideType: RideType.Twist, x: 8, y: 8 });
    const ride = sim.world.rides.slotToId[sim.world.rides.spawn()];
    sim.enqueue({
      type: 'placeTrack',
      rideId: ride,
      pieceType: PieceId.Station,
      x: 10,
      y: 10,
      z: 4,
      dir: 0,
      mode: 0,
    });
    sim.step();
    expect(sim.world.economy.cash).toBe(PATH_COST_CENTS - 1);
    expect(sim.world.map.isWalkable(sim.world.map.index(4, 4))).toBe(false);
    expect(sim.world.map.ownership[0]).toBe(4);
    expect(sim.world.rides.count).toBe(1);
    expect(sim.world.track.pieces.count).toBe(0);
    expect(PIECES[PieceId.Station].cost).toBeGreaterThan(PATH_COST_CENTS - 1);
  });

  it('only rejects a ride when cash is short of its price', () => {
    const cost = RIDE_CATALOG[RideType.FoodStall].cost;
    const sim = simWithCash(cost);
    sim.enqueue({ type: 'createRide', rideType: RideType.FoodStall, x: 5, y: 5 });
    sim.step();
    expect(sim.world.rides.count).toBe(1);
    expect(sim.world.economy.cash).toBe(0);
    sim.enqueue({ type: 'createRide', rideType: RideType.FoodStall, x: 7, y: 5 });
    sim.step();
    expect(sim.world.rides.count).toBe(1);
  });
});
