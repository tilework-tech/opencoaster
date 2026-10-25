import type { World } from '../core/world';
import { PIECES } from '../track/catalog';
import { RIDE_CATALOG } from './ride-types';
import type { RideType } from './ride-types';

export function rideConstructionCost(world: World, rideId: number): number {
  if (!world.rides.isAlive(rideId)) return 0;
  const rideSlot = world.rides.idToSlot[rideId];
  const rideType = world.rides.cols.typeId[rideSlot] as RideType;
  let cost = RIDE_CATALOG[rideType]?.cost ?? 0;
  const tracks = world.track.pieces;
  for (let slot = 0; slot < tracks.count; slot++) {
    if (tracks.cols.rideId[slot] === rideId) cost += PIECES[tracks.cols.pieceType[slot]]?.cost ?? 0;
  }
  return cost;
}

export function demolitionRefund(world: World, rideId: number): number {
  if (!world.rides.isAlive(rideId)) return 0;
  const slot = world.rides.idToSlot[rideId];
  const cost = rideConstructionCost(world, rideId);
  return world.rides.cols.guestsServed[slot] === 0 ? cost : Math.floor((cost * 70) / 100);
}
