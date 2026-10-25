import type { World } from '../core/world';
import { applyMapCommand } from '../map/map-commands';
import { applyRideCommand } from '../rides/ride-commands';
import { createRide } from '../rides/ride-operations';
import { RIDE_CATALOG, RideType } from '../rides/ride-types';
import { ParkGrid, rideFrontage } from './park-grid';
import type { EntranceSide, PrebuiltRide } from './scenario';

/** Ride names accepted in scenario files. */
export const PREBUILT_TYPES: Record<string, RideType> = {
  merryGoRound: RideType.MerryGoRound,
  swingingShip: RideType.SwingingShip,
  ferrisWheel: RideType.FerrisWheel,
  twist: RideType.Twist,
  foodStall: RideType.FoodStall,
  drinkStall: RideType.DrinkStall,
  informationKiosk: RideType.InformationKiosk,
  toilets: RideType.Toilets,
};

/**
 * Builds the scenario's standing rides along the spine path inward from the gate, each with a
 * queue, entrance, exit and open status. Construction is free: the caller restores cash and the
 * monthly ledger afterwards.
 */
export function placePrebuilt(
  world: World,
  side: EntranceSide,
  rides: readonly PrebuiltRide[],
): void {
  const gx = world.park.entranceX;
  if (gx < 0 || rides.length === 0) return;
  const grid = new ParkGrid(gx, world.park.entranceY, side);
  const lastRow = Math.max(...rides.map((r) => r.row));
  for (let row = 1; row <= lastRow; row++) {
    const [x, y] = grid.tile(row, 0);
    applyMapCommand(world, { type: 'placePath', x, y });
  }
  for (const spec of rides) {
    const rideType = PREBUILT_TYPES[spec.type];
    const frontage = rideFrontage(grid, spec.row, spec.lateral, RIDE_CATALOG[rideType].footprint);
    const serviceRide =
      rideType === RideType.FoodStall ||
      rideType === RideType.DrinkStall ||
      rideType === RideType.InformationKiosk ||
      rideType === RideType.Toilets;
    for (const [x, y] of frontage.queue) {
      applyMapCommand(world, { type: 'placePath', x, y, queue: !serviceRide });
    }
    for (const [x, y] of frontage.exitPath) applyMapCommand(world, { type: 'placePath', x, y });
    const rideId = createRide(world, rideType, frontage.ride[0], frontage.ride[1], frontage.dir);
    if (rideId < 0) continue;
    applyRideCommand(world, {
      type: 'placeRideEntrance',
      rideId,
      x: frontage.entrance[0],
      y: frontage.entrance[1],
    });
    if (!serviceRide)
      applyRideCommand(world, {
        type: 'placeRideExit',
        rideId,
        x: frontage.exit[0],
        y: frontage.exit[1],
      });
    applyRideCommand(world, { type: 'setRideStatus', rideId, status: 'open' });
  }
}
