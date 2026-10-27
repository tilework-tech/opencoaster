import { TRACK_STEPS_PER_LEVEL } from '../core/constants';
import { Simulation } from '../core/simulation';
import { GuestState, spawnGuest } from '../guests/guest-store';
import { OWNED } from '../map/tile-map';
import { pieceByName } from '../track/catalog';
import { getConstructionCursor } from '../track/construction';
import { PieceMode } from '../track/track-types';
import { RideType } from './ride-types';

/** Station followed by a lifted climb, four right-hand turns and a drop; closes after 14 pieces. */
export const SMALL_CIRCUIT: ReadonlyArray<readonly [string, PieceMode]> = [
  ['station', PieceMode.Normal],
  ['flatToUp25', PieceMode.ChainLift],
  ['up25', PieceMode.ChainLift],
  ['up25ToFlat', PieceMode.ChainLift],
  ['smallRight', PieceMode.Normal],
  ['flat', PieceMode.Normal],
  ['smallRight', PieceMode.Normal],
  ['flatToDown25', PieceMode.Normal],
  ['down25', PieceMode.Normal],
  ['down25ToFlat', PieceMode.Normal],
  ['flat', PieceMode.Normal],
  ['smallRight', PieceMode.Normal],
  ['flat', PieceMode.Normal],
  ['smallRight', PieceMode.Normal],
];

export const STATION_X = 20;
export const STATION_Y = 20;
export const GROUND = 2;

/** A flat, fully owned park with the given seed. */
export function flatOwnedSim(seed = 1): Simulation {
  const sim = new Simulation({ seed, width: 48, height: 48, maxGuests: 64 });
  sim.world.map.waterLevel.fill(0);
  sim.world.map.fillFlat(GROUND);
  sim.world.map.ownership.fill(OWNED);
  return sim;
}

export function createCoaster(
  sim: Simulation,
  rideType: RideType = RideType.WoodenCoaster,
  x = STATION_X,
  y = STATION_Y - 4,
): number {
  sim.world.research.unlocked.add(rideType);
  sim.enqueue({ type: 'createRide', rideType, x, y });
  sim.step();
  return sim.world.rides.slotToId[sim.world.rides.count - 1];
}

/** Places each piece at the construction cursor, one command per tick. */
export function buildCircuit(
  sim: Simulation,
  rideId: number,
  layout: ReadonlyArray<readonly [string, PieceMode]> = SMALL_CIRCUIT,
): void {
  for (const [name, mode] of layout) {
    const cursor = getConstructionCursor(sim.world, rideId);
    sim.enqueue({
      type: 'placeTrack',
      rideId,
      pieceType: pieceByName(name)!.id,
      x: cursor.hasTrack ? cursor.x : STATION_X,
      y: cursor.hasTrack ? cursor.y : STATION_Y,
      z: cursor.hasTrack ? cursor.z : GROUND * TRACK_STEPS_PER_LEVEL,
      dir: cursor.hasTrack ? cursor.dir : 0,
      mode,
    });
    sim.step();
  }
}

/** Entrance on the station's -y side, exit on its +y side, one path tile beyond the entrance. */
export function connectStation(sim: Simulation, rideId: number): void {
  sim.enqueue({ type: 'placePath', x: STATION_X, y: STATION_Y - 2 });
  sim.enqueue({ type: 'placeRideEntrance', rideId, x: STATION_X, y: STATION_Y - 1 });
  sim.enqueue({ type: 'placeRideExit', rideId, x: STATION_X, y: STATION_Y + 1 });
  sim.step();
}

export function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

/** Puts guests at the head of the ride's queue, as if they had walked up to the entrance. */
export function queueGuests(sim: Simulation, rideId: number, count: number): void {
  const world = sim.world;
  const slot = world.rides.idToSlot[rideId];
  for (let i = 0; i < count; i++) {
    if (!spawnGuest(world)) return;
    const guest = world.guests.count - 1;
    world.guests.cols.state[guest] = GuestState.Waiting;
    world.guests.cols.targetRide[guest] = rideId;
    world.rides.cols.queueLength[slot]++;
  }
}
