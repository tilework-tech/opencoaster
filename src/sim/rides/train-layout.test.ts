import { describe, expect, it } from 'vitest';
import type { Simulation } from '../core/simulation';
import { deserialize, serialize } from '../../save/save';
import { PieceMode } from '../track/track-types';
import {
  SMALL_CIRCUIT,
  buildCircuit,
  connectStation,
  createCoaster,
  flatOwnedSim,
  queueGuests,
  run,
} from './coaster-fixtures';
import { RideResult } from './ride-results';
import { RideType } from './ride-types';
import { rideTrainSlots } from '../vehicles/ride-trains';

/** SMALL_CIRCUIT with block brakes on two flat pieces: three block zones, so up to two trains. */
const TWO_BLOCK_LAYOUT = SMALL_CIRCUIT.map(
  ([name, mode], i) => [name, i === 5 || i === 10 ? PieceMode.BlockBrake : mode] as const,
);

function openedCoaster(): { sim: Simulation; rideId: number; slot: number } {
  const sim = flatOwnedSim(1);
  const rideId = createCoaster(sim, RideType.WoodenCoaster);
  buildCircuit(sim, rideId, TWO_BLOCK_LAYOUT);
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
  run(sim, 8000);
  connectStation(sim, rideId);
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
  sim.step();
  return { sim, rideId, slot: sim.world.rides.idToSlot[rideId] };
}

function setTrains(sim: Simulation, rideId: number, trains: number, cars: number): RideResult {
  sim.enqueue({ type: 'setRideTrains', rideId, trains, cars });
  sim.step();
  return sim.world.feedback.code as RideResult;
}

describe('train count and cars per train', () => {
  it('runs only the number of trains the operator asks for', () => {
    const { sim, rideId } = openedCoaster();
    queueGuests(sim, rideId, 40);
    expect(setTrains(sim, rideId, 1, 0)).toBe(RideResult.Ok);
    run(sim, 1500);
    expect(rideTrainSlots(sim.world, rideId).length).toBe(1);
  });

  it('never runs more trains than the block sections allow, even when asked', () => {
    const { sim, rideId } = openedCoaster();
    queueGuests(sim, rideId, 40);
    expect(setTrains(sim, rideId, 4, 0)).toBe(RideResult.Ok);
    run(sim, 1500);
    expect(rideTrainSlots(sim.world, rideId).length).toBe(2);
  });

  it('refuses a train count or car count outside the allowed range', () => {
    const { sim, rideId } = openedCoaster();
    expect(setTrains(sim, rideId, 5, 0)).toBe(RideResult.Blocked);
    expect(setTrains(sim, rideId, 1, 6)).toBe(RideResult.Blocked);
    expect(setTrains(sim, rideId, -1, 0)).toBe(RideResult.Blocked);
  });

  it('sets the riders per dispatch from the cars, and restores the default for zero', () => {
    const { sim, rideId, slot } = openedCoaster();
    const defaultCapacity = sim.world.rides.cols.capacity[slot];
    setTrains(sim, rideId, 0, 3);
    expect(sim.world.rides.cols.capacity[slot]).toBe(12);
    expect(sim.world.rides.cols.carsPerTrain[slot]).toBe(3);
    setTrains(sim, rideId, 0, 0);
    expect(sim.world.rides.cols.capacity[slot]).toBe(defaultCapacity);
  });

  it('keeps the setting through a save and load', () => {
    const { sim, rideId } = openedCoaster();
    setTrains(sim, rideId, 1, 4);
    const loaded = deserialize(serialize(sim.world));
    const slot = loaded.rides.idToSlot[rideId];
    expect(loaded.rides.cols.trainCount[slot]).toBe(1);
    expect(loaded.rides.cols.carsPerTrain[slot]).toBe(4);
  });
});
