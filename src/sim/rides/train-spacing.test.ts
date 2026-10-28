import { describe, expect, it } from 'vitest';
import { PieceMode } from '../track/track-types';
import { maxTrainsForRide } from '../vehicles/ride-trains';
import { CAR_LENGTH_Q8 } from '../vehicles/vehicle-system';
import { VehicleState } from '../vehicles/vehicle-store';
import type { Simulation } from '../core/simulation';
import {
  SMALL_CIRCUIT,
  buildCircuit,
  connectStation,
  createCoaster,
  flatOwnedSim,
  queueGuests,
  run,
} from './coaster-fixtures';
import { RideMode } from './ride-modes';
import { isRideTested } from './ride-operations';
import { RideResult } from './ride-results';
import { RideType } from './ride-types';

/** SMALL_CIRCUIT with block brakes on the given pieces. */
function withBrakes(...pieces: number[]) {
  return SMALL_CIRCUIT.map(
    ([name, mode], i) => [name, pieces.includes(i) ? PieceMode.BlockBrake : mode] as const,
  );
}

const NO_BRAKES = SMALL_CIRCUIT;
const THREE_BRAKES = withBrakes(5, 10, 12);

function openedCoaster(
  layout: ReadonlyArray<readonly [string, PieceMode]>,
  mode: RideMode,
  trains: number,
) {
  const sim = flatOwnedSim(1);
  const rideId = createCoaster(sim, RideType.WoodenCoaster);
  buildCircuit(sim, rideId, layout);
  sim.enqueue({ type: 'setRideMode', rideId, mode });
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
  for (let i = 0; i < 40 && !isRideTested(sim.world, rideId); i++) run(sim, 1000);
  connectStation(sim, rideId);
  sim.enqueue({ type: 'setRideTrains', rideId, trains, cars: 2 });
  sim.step();
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
  sim.step();
  return { sim, rideId, slot: sim.world.rides.idToSlot[rideId] };
}

/** Tick-by-tick check that no two trains share track; returns the most trains seen running. */
function runWithoutOverlap(sim: Simulation, rideId: number, ticks: number): number {
  const v = sim.world.vehicles.cols;
  const track = () => sim.world.vehicleTracks!.get(rideId)!;
  let most = 0;
  for (let i = 0; i < ticks; i++) {
    if (i % 100 === 0) queueGuests(sim, rideId, 8);
    sim.step();
    const total = track().totalLengthQ8;
    const spans: Array<{ rear: number; length: number }> = [];
    let moving = 0;
    for (let t = 0; t < sim.world.vehicles.count; t++) {
      const length = v.carCount[t] * CAR_LENGTH_Q8;
      spans.push({ rear: v.trackPos[t] - length, length });
      if (v.state[t] === VehicleState.Running || v.state[t] === VehicleState.Arriving) moving++;
    }
    most = Math.max(most, moving);
    for (let a = 0; a < spans.length; a++) {
      for (let b = a + 1; b < spans.length; b++) {
        const aToB = (((spans[b].rear - spans[a].rear) % total) + total) % total;
        const bToA = (((spans[a].rear - spans[b].rear) % total) + total) % total;
        expect(
          aToB < spans[a].length || bToA < spans[b].length,
          `trains overlap at tick ${i}`,
        ).toBe(false);
      }
    }
  }
  return most;
}

describe('how many trains a coaster takes', () => {
  it('lets a continuous circuit without block brakes take several trains', () => {
    const { sim, rideId } = openedCoaster(NO_BRAKES, RideMode.ContinuousCircuit, 1);
    expect(maxTrainsForRide(sim.world, rideId)).toBeGreaterThanOrEqual(3);
  });

  it('limits a block-sectioned circuit to its stations plus block brakes, minus one', () => {
    const none = openedCoaster(NO_BRAKES, RideMode.ContinuousCircuitBlockSectioned, 1);
    expect(maxTrainsForRide(none.sim.world, none.rideId)).toBe(1);
    const three = openedCoaster(THREE_BRAKES, RideMode.ContinuousCircuitBlockSectioned, 1);
    expect(maxTrainsForRide(three.sim.world, three.rideId)).toBe(3);
  });

  it('ignores block brakes in continuous circuit mode', () => {
    const plain = openedCoaster(NO_BRAKES, RideMode.ContinuousCircuit, 1);
    const braked = openedCoaster(THREE_BRAKES, RideMode.ContinuousCircuit, 1);
    expect(braked.sim.world.vehicleTracks!.get(braked.rideId)!.boundariesQ8.length).toBe(0);
    expect(maxTrainsForRide(braked.sim.world, braked.rideId)).toBe(
      maxTrainsForRide(plain.sim.world, plain.rideId),
    );
  });

  it('switches a ride that offers block sections to them when a block brake is placed', () => {
    const sim = flatOwnedSim(1);
    const rideId = createCoaster(sim, RideType.WoodenCoaster);
    const slot = sim.world.rides.idToSlot[rideId];
    buildCircuit(sim, rideId, NO_BRAKES);
    expect(sim.world.rides.cols.mode[slot]).toBe(RideMode.ContinuousCircuit);
    const other = flatOwnedSim(1);
    const braked = createCoaster(other, RideType.WoodenCoaster);
    buildCircuit(other, braked, THREE_BRAKES);
    expect(other.world.rides.cols.mode[other.world.rides.idToSlot[braked]]).toBe(
      RideMode.ContinuousCircuitBlockSectioned,
    );
  });

  it('refuses more trains than the mode allows', () => {
    const { sim, rideId } = openedCoaster(NO_BRAKES, RideMode.ContinuousCircuitBlockSectioned, 1);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'close' });
    run(sim, 3000);
    sim.enqueue({ type: 'setRideTrains', rideId, trains: 2, cars: 2 });
    sim.step();
    expect(sim.world.feedback.code).toBe(RideResult.Blocked);
  });
});

describe('trains sharing a coaster', () => {
  it('keeps 3 trains on a block-sectioned circuit out of each other’s block', () => {
    const { sim, rideId } = openedCoaster(
      THREE_BRAKES,
      RideMode.ContinuousCircuitBlockSectioned,
      3,
    );
    expect(runWithoutOverlap(sim, rideId, 12000)).toBeGreaterThanOrEqual(2);
    expect(sim.world.vehicles.count).toBe(3);
  });

  it('never puts two trains in one block section', () => {
    const { sim, rideId } = openedCoaster(
      THREE_BRAKES,
      RideMode.ContinuousCircuitBlockSectioned,
      3,
    );
    const v = sim.world.vehicles.cols;
    for (let i = 0; i < 12000; i++) {
      if (i % 100 === 0) queueGuests(sim, rideId, 8);
      sim.step();
      const track = sim.world.vehicleTracks!.get(rideId)!;
      const ends = Array.from(track.boundariesQ8);
      const zoneOf = (pos: number) => ends.findIndex((end) => pos <= end);
      const front = new Set<number>();
      for (let t = 0; t < sim.world.vehicles.count; t++) {
        const zone = zoneOf(Math.min(v.trackPos[t], track.totalLengthQ8));
        expect(front.has(zone), `two trains in zone ${zone} at tick ${i}`).toBe(false);
        front.add(zone);
      }
    }
  });

  it('runs 3 trains round a continuous circuit with no block brakes without overlapping', () => {
    const { sim, rideId, slot } = openedCoaster(NO_BRAKES, RideMode.ContinuousCircuit, 3);
    expect(runWithoutOverlap(sim, rideId, 14000)).toBeGreaterThanOrEqual(2);
    expect(sim.world.vehicles.count).toBe(3);
    expect(sim.world.rides.cols.guestsServed[slot]).toBeGreaterThanOrEqual(32);
  });
});
