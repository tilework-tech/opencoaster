import { describe, expect, it } from 'vitest';
import type { Simulation } from '../core/simulation';
import type { PieceMode } from '../track/track-types';
import { circuitStatus } from '../track/construction';
import { rideTrainSlots } from '../vehicles/ride-trains';
import { VehicleState } from '../vehicles/vehicle-store';
import { syncVehicleTracks, VehicleTrackRegistry } from '../vehicles/vehicle-track';
import {
  SMALL_CIRCUIT,
  buildCircuit,
  createCoaster,
  flatOwnedSim,
  queueGuests,
  run,
} from './coaster-fixtures';
import { RideType } from './ride-types';

/** SMALL_CIRCUIT as a cycle, started `offset` pieces in; every offset used starts on level track. */
function rotated(offset: number): ReadonlyArray<readonly [string, PieceMode]> {
  return [...SMALL_CIRCUIT.slice(offset), ...SMALL_CIRCUIT.slice(0, offset)];
}

const LAYOUTS: ReadonlyArray<[string, number]> = [
  ['station is the first piece', 0],
  ['station is the last piece, closing the circuit', 1],
  ['station sits mid-circuit, built after a flat and a turn', 10],
];

const NEIGHBOURS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
] as const;

/** Entrance and exit on opposite sides of the station piece, wherever the build order put it. */
function connectAnywhere(sim: Simulation, rideId: number): void {
  const pieces = sim.world.track.pieces;
  let station: { x: number; y: number } | undefined;
  for (let s = 0; s < pieces.count; s++) {
    if (pieces.cols.rideId[s] === rideId && pieces.cols.pieceType[s] === stationType())
      station = { x: pieces.cols.x[s], y: pieces.cols.y[s] };
  }
  if (!station) throw new Error('no station piece');
  const slot = sim.world.rides.idToSlot[rideId];
  const ride = sim.world.rides.cols;
  for (const [dx, dy] of NEIGHBOURS) {
    if (ride.entrancePlaced[slot]) break;
    sim.enqueue({ type: 'placePath', x: station.x + dx * 2, y: station.y + dy * 2 });
    sim.enqueue({ type: 'placeRideEntrance', rideId, x: station.x + dx, y: station.y + dy });
    sim.step();
  }
  for (const [dx, dy] of NEIGHBOURS) {
    if (ride.exitPlaced[slot]) break;
    sim.enqueue({ type: 'placeRideExit', rideId, x: station.x + dx, y: station.y + dy });
    sim.step();
  }
}

import { pieceByName } from '../track/catalog';
function stationType(): number {
  return pieceByName('station')!.id;
}

function built(offset: number) {
  const sim = flatOwnedSim(1);
  const rideId = createCoaster(sim, RideType.WoodenCoaster);
  buildCircuit(sim, rideId, rotated(offset));
  const slot = sim.world.rides.idToSlot[rideId];
  return { sim, rideId, slot };
}

describe.each(LAYOUTS)('a coaster whose %s', (_name, offset) => {
  it('starts its test lap on the station platform and completes it', () => {
    const { sim, rideId, slot } = built(offset);
    expect(circuitStatus(sim.world, rideId).complete).toBe(true);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    sim.step();
    const tracks = new VehicleTrackRegistry();
    syncVehicleTracks(sim.world, tracks);
    const track = tracks.get(rideId)!;
    const train = rideTrainSlots(sim.world, rideId)[0];
    expect(sim.world.vehicles.cols.state[train]).toBe(VehicleState.Testing);
    const start = track.cumulativeLengthsQ8[track.stationSegment];
    const ahead = sim.world.vehicles.cols.trackPos[train] - start;
    expect(ahead).toBeGreaterThanOrEqual(0);
    expect(ahead).toBeLessThan(1024);
    run(sim, 9000);
    expect(sim.world.rides.cols.tested[slot]).toBe(1);
  });

  it('parks the train at the front of the platform and carries guests once opened', () => {
    const { sim, rideId, slot } = built(offset);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    run(sim, 9000);
    connectAnywhere(sim, rideId);
    run(sim, 30);
    const tracks = new VehicleTrackRegistry();
    syncVehicleTracks(sim.world, tracks);
    const track = tracks.get(rideId)!;
    const train = rideTrainSlots(sim.world, rideId)[0];
    const platformEnd = track.stationEndQ8 % track.totalLengthQ8;
    expect(sim.world.vehicles.cols.trackPos[train]).toBe(platformEnd);
    queueGuests(sim, rideId, 12);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    run(sim, 3000);
    expect(sim.world.rides.cols.state[slot]).toBe(1);
    expect(sim.world.rides.cols.guestsServed[slot]).toBeGreaterThan(0);
  });
});
