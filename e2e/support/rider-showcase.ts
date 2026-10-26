import { RideType } from '../../src/sim/rides/ride-types';
import {
  buildCircuit,
  connectStation,
  createCoaster,
  flatOwnedSim,
  queueGuests,
  run,
  SMALL_CIRCUIT,
  STATION_X,
  STATION_Y,
} from '../../src/sim/rides/coaster-fixtures';
import { GuestState } from '../../src/sim/guests/guest-store';
import { PieceMode } from '../../src/sim/track/track-types';
import { serialize } from '../../src/save/save';
import { TILE_UNITS } from '../../src/sim/core/constants';
import type { Simulation } from '../../src/sim/core/simulation';

const N = PieceMode.Normal;

const WATER_CIRCUIT: ReadonlyArray<readonly [string, PieceMode]> = [
  ['station', N],
  ['flatToUp25', 5 as PieceMode],
  ['up25', 5 as PieceMode],
  ['up25ToFlat', 5 as PieceMode],
  ['smallRight', N],
  ['flat', N],
  ['smallRight', N],
  ['waterSplashDrop', N],
  ['down25', N],
  ['down25ToFlat', N],
  ['flat', N],
  ['smallRight', N],
  ['flat', N],
  ['smallRight', N],
];

export type ShowcaseRide = 'coaster' | 'flat-ride' | 'log-flume';

export interface RiderShowcase {
  save: Uint8Array;
  /** World-unit point to centre the camera on. */
  focus: { x: number; y: number; z: number };
}

function openTrackRide(sim: Simulation, rideId: number): void {
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
  run(sim, 8000);
  connectStation(sim, rideId);
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
  sim.step();
  queueGuests(sim, rideId, 12);
}

function ridingGuests(sim: Simulation): number {
  let n = 0;
  for (let g = 0; g < sim.world.guests.count; g++)
    if (sim.world.guests.cols.state[g] === GuestState.Riding) n++;
  return n;
}

/** Runs until guests are riding and the ride has been running for `extra` ticks. */
function runUntilRiding(sim: Simulation, extra: number): void {
  for (let i = 0; i < 20_000 && ridingGuests(sim) === 0; i++) sim.step();
  run(sim, extra);
}

function carFocus(sim: Simulation): RiderShowcase['focus'] {
  const v = sim.world.vehicles.cols;
  for (let i = 0; i < sim.world.vehicles.count; i++)
    if (v.passengers[i] > 0) return { x: v.x[i], y: v.y[i], z: v.z[i] };
  return { x: STATION_X * TILE_UNITS, y: STATION_Y * TILE_UNITS, z: 0 };
}

/** A 48x48 park with one ride mid-cycle with guests aboard. */
export function riderShowcase(kind: ShowcaseRide, extraTicks = 150): RiderShowcase {
  const sim = flatOwnedSim(1);
  if (kind === 'flat-ride') {
    sim.world.research.unlocked.add(RideType.MerryGoRound);
    sim.enqueue({ type: 'createRide', rideType: RideType.MerryGoRound, x: 20, y: 20 });
    sim.step();
    const rideId = sim.world.rides.slotToId[sim.world.rides.count - 1];
    sim.enqueue({ type: 'placePath', x: 20, y: 18 });
    sim.enqueue({ type: 'placeRideEntrance', rideId, x: 20, y: 19 });
    sim.enqueue({ type: 'placeRideExit', rideId, x: 20, y: 21 });
    sim.step();
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    sim.step();
    queueGuests(sim, rideId, 6);
    runUntilRiding(sim, 60);
    return {
      save: serialize(sim.world),
      focus: { x: 20 * TILE_UNITS + TILE_UNITS / 2, y: 20 * TILE_UNITS + TILE_UNITS / 2, z: 0 },
    };
  }
  const rideId = createCoaster(
    sim,
    kind === 'log-flume' ? RideType.LogFlume : RideType.WoodenCoaster,
  );
  buildCircuit(sim, rideId, kind === 'log-flume' ? WATER_CIRCUIT : SMALL_CIRCUIT);
  openTrackRide(sim, rideId);
  runUntilRiding(sim, extraTicks);
  return { save: serialize(sim.world), focus: carFocus(sim) };
}
