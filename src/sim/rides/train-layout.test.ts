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
import { RideMode } from './ride-modes';
import { RideType } from './ride-types';
import { maxCarsForRide, maxTrainsForRide, rideTrainSlots } from '../vehicles/ride-trains';
import { VehicleState } from '../vehicles/vehicle-store';

/** SMALL_CIRCUIT with block brakes on two flat pieces: three block zones, so up to two trains. */
const TWO_BLOCK_LAYOUT = SMALL_CIRCUIT.map(
  ([name, mode], i) => [name, i === 5 || i === 10 ? PieceMode.BlockBrake : mode] as const,
);

function openedCoaster(): { sim: Simulation; rideId: number; slot: number } {
  const sim = flatOwnedSim(1);
  const rideId = createCoaster(sim, RideType.WoodenCoaster);
  buildCircuit(sim, rideId, TWO_BLOCK_LAYOUT);
  sim.enqueue({ type: 'setRideMode', rideId, mode: RideMode.ContinuousCircuitBlockSectioned });
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
  run(sim, 8000);
  connectStation(sim, rideId);
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
  sim.step();
  return { sim, rideId, slot: sim.world.rides.idToSlot[rideId] };
}

function closedCoaster(): { sim: Simulation; rideId: number; slot: number } {
  const sim = flatOwnedSim(1);
  const rideId = createCoaster(sim, RideType.WoodenCoaster);
  buildCircuit(sim, rideId, TWO_BLOCK_LAYOUT);
  sim.enqueue({ type: 'setRideMode', rideId, mode: RideMode.ContinuousCircuitBlockSectioned });
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
  run(sim, 8000);
  connectStation(sim, rideId);
  sim.step();
  return { sim, rideId, slot: sim.world.rides.idToSlot[rideId] };
}

function carCounts(sim: Simulation, rideId: number): number[] {
  return rideTrainSlots(sim.world, rideId).map((t) => sim.world.vehicles.cols.carCount[t]);
}

function setTrains(sim: Simulation, rideId: number, trains: number, cars: number): RideResult {
  sim.enqueue({ type: 'setRideTrains', rideId, trains, cars });
  sim.step();
  return sim.world.feedback.code as RideResult;
}

describe('train count and cars per train', () => {
  it('runs only the number of trains the operator asks for', () => {
    const { sim, rideId } = closedCoaster();
    queueGuests(sim, rideId, 40);
    expect(setTrains(sim, rideId, 1, 0)).toBe(RideResult.Ok);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    run(sim, 1500);
    expect(rideTrainSlots(sim.world, rideId).length).toBe(1);
  });

  it('refuses a train count or car count outside the allowed range', () => {
    const { sim, rideId } = closedCoaster();
    expect(setTrains(sim, rideId, 5, 0)).toBe(RideResult.Blocked);
    expect(setTrains(sim, rideId, 1, 6)).toBe(RideResult.Blocked);
    expect(setTrains(sim, rideId, -1, 0)).toBe(RideResult.Blocked);
  });

  it('sets the riders per dispatch from the cars, and restores the default for zero', () => {
    const { sim, rideId, slot } = closedCoaster();
    const defaultCapacity = sim.world.rides.cols.capacity[slot];
    setTrains(sim, rideId, 0, 3);
    expect(sim.world.rides.cols.capacity[slot]).toBe(12);
    expect(sim.world.rides.cols.carsPerTrain[slot]).toBe(3);
    setTrains(sim, rideId, 0, 0);
    expect(sim.world.rides.cols.capacity[slot]).toBe(defaultCapacity);
  });

  it('keeps the setting through a save and load', () => {
    const { sim, rideId } = closedCoaster();
    setTrains(sim, rideId, 1, 4);
    const loaded = deserialize(serialize(sim.world));
    const slot = loaded.rides.idToSlot[rideId];
    expect(loaded.rides.cols.trainCount[slot]).toBe(1);
    expect(loaded.rides.cols.carsPerTrain[slot]).toBe(4);
  });
});

describe('changing the train layout', () => {
  it('refuses to change trains or cars while the ride is open', () => {
    const { sim, rideId, slot } = openedCoaster();
    expect(setTrains(sim, rideId, 1, 2)).toBe(RideResult.Busy);
    expect(sim.world.rides.cols.trainCount[slot]).toBe(0);
    expect(sim.world.rides.cols.carsPerTrain[slot]).toBe(0);
  });

  it('refuses a car count that does not fit the station and a train count beyond the block sections', () => {
    const { sim, rideId } = closedCoaster();
    const cars = maxCarsForRide(sim.world, rideId);
    const trains = maxTrainsForRide(sim.world, rideId);
    expect(cars).toBeGreaterThanOrEqual(1);
    expect(trains).toBe(2);
    expect(setTrains(sim, rideId, 0, cars + 1)).toBe(RideResult.Blocked);
    expect(setTrains(sim, rideId, trains + 1, 0)).toBe(RideResult.Blocked);
    expect(setTrains(sim, rideId, trains, cars)).toBe(RideResult.Ok);
  });

  it('parks a train with the new number of cars in the station when the ride is closed', () => {
    const { sim, rideId } = closedCoaster();
    expect(carCounts(sim, rideId)).toHaveLength(1);
    setTrains(sim, rideId, 0, 2);
    run(sim, 30);
    expect(carCounts(sim, rideId)).toEqual([2]);
    setTrains(sim, rideId, 0, 3);
    run(sim, 30);
    expect(carCounts(sim, rideId)).toEqual([3]);
    const train = rideTrainSlots(sim.world, rideId)[0];
    expect(sim.world.vehicles.cols.state[train]).toBe(VehicleState.Waiting);
  });

  it('opens with the parked composition and boards the new capacity', () => {
    const { sim, rideId, slot } = closedCoaster();
    setTrains(sim, rideId, 2, 2);
    queueGuests(sim, rideId, 40);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    run(sim, 1500);
    expect(carCounts(sim, rideId)).toEqual([2, 2]);
    expect(sim.world.rides.cols.capacity[slot]).toBe(8);
    for (const t of rideTrainSlots(sim.world, rideId))
      expect(sim.world.vehicles.cols.passengers[t]).toBeLessThanOrEqual(8);
    expect(
      sim.world.rides.cols.guestsServed[slot] + sim.world.rides.cols.boarded[slot],
    ).toBeGreaterThan(0);
  });

  it('keeps parked trains through a save and load', () => {
    const { sim, rideId } = closedCoaster();
    setTrains(sim, rideId, 0, 3);
    run(sim, 30);
    const loaded = deserialize(serialize(sim.world));
    expect(rideTrainSlots(loaded, rideId).map((t) => loaded.vehicles.cols.carCount[t])).toEqual([
      3,
    ]);
  });
});
