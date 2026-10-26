import { RideType } from '../../src/sim/rides/ride-types';
import {
  buildCircuit,
  connectStation,
  createCoaster,
  flatOwnedSim,
  queueGuests,
  run,
} from '../../src/sim/rides/coaster-fixtures';
import { GuestState } from '../../src/sim/guests/guest-store';
import { markPathElementBroken } from '../../src/sim/map/tile-map';
import { serialize } from '../../src/save/save';

/** Tile of the vandalised bench and the intact bin in the inspection showcase. */
export const BENCH_TILE = { x: 31, y: 40 };
export const BIN_TILE = { x: 32, y: 40 };

/** A park with a running coaster, a merry-go-round with entrance and exit, and a bench and bin. */
export function inspectionShowcase(): Uint8Array {
  const sim = flatOwnedSim(1);
  const coaster = createCoaster(sim, RideType.WoodenCoaster);
  buildCircuit(sim, coaster);
  sim.enqueue({ type: 'setRideStatus', rideId: coaster, status: 'test' });
  run(sim, 8000);
  connectStation(sim, coaster);
  sim.enqueue({ type: 'setRideStatus', rideId: coaster, status: 'open' });
  sim.step();
  queueGuests(sim, coaster, 12);
  for (let i = 0; i < 20_000; i++) {
    let riding = 0;
    for (let g = 0; g < sim.world.guests.count; g++)
      if (sim.world.guests.cols.state[g] === GuestState.Riding) riding++;
    if (riding > 0) break;
    sim.step();
  }

  sim.world.research.unlocked.add(RideType.MerryGoRound);
  sim.enqueue({ type: 'createRide', rideType: RideType.MerryGoRound, x: 34, y: 34 });
  sim.step();
  const flat = sim.world.rides.slotToId[sim.world.rides.count - 1];
  sim.enqueue({ type: 'placePath', x: 34, y: 32 });
  sim.enqueue({ type: 'placeRideEntrance', rideId: flat, x: 34, y: 33 });
  sim.enqueue({ type: 'placeRideExit', rideId: flat, x: 34, y: 35 });
  sim.step();
  sim.enqueue({ type: 'setRideStatus', rideId: flat, status: 'open' });

  for (let x = 30; x <= 33; x++) sim.enqueue({ type: 'placePath', x, y: BENCH_TILE.y });
  sim.step();
  sim.enqueue({ type: 'setPathAddition', ...BENCH_TILE, addition: 2 });
  sim.enqueue({ type: 'setPathAddition', ...BIN_TILE, addition: 1 });
  sim.step();
  const map = sim.world.map;
  markPathElementBroken(map, map.pathElement(BENCH_TILE.y * map.width + BENCH_TILE.x, -1));
  sim.step();
  return serialize(sim.world);
}
