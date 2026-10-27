import { describe, expect, it } from 'vitest';
import { deserialize, serialize } from '../../save/save';
import { FeedbackDomain } from '../core/feedback';
import type { Simulation } from '../core/simulation';
import {
  SMALL_CIRCUIT,
  buildCircuit,
  connectStation,
  createCoaster,
  flatOwnedSim,
  run,
} from './coaster-fixtures';
import { RideResult } from './ride-results';
import { RideState } from './ride-store';
import { RideType } from './ride-types';

function open(sim: Simulation, rideId: number): RideResult {
  sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
  sim.step();
  return sim.world.feedback.code as RideResult;
}

function coasterWith(layout = SMALL_CIRCUIT) {
  const sim = flatOwnedSim(1);
  const rideId = createCoaster(sim, RideType.WoodenCoaster);
  buildCircuit(sim, rideId, layout);
  return { sim, rideId, slot: sim.world.rides.idToSlot[rideId] };
}

describe('opening a tracked ride', () => {
  it('is refused, and the ride stays closed, while the circuit is incomplete', () => {
    const { sim, rideId, slot } = coasterWith(SMALL_CIRCUIT.slice(0, 6));
    expect(open(sim, rideId)).toBe(RideResult.TrackIncomplete);
    expect(sim.world.rides.cols.state[slot]).toBe(RideState.Closed);
  });

  it('is refused until the ride has been tested', () => {
    const { sim, rideId, slot } = coasterWith();
    connectStation(sim, rideId);
    expect(open(sim, rideId)).toBe(RideResult.NotTested);
    expect(sim.world.rides.cols.state[slot]).toBe(RideState.Closed);
  });

  it('is refused without an entrance and then without an exit', () => {
    const { sim, rideId } = coasterWith();
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    run(sim, 9000);
    expect(open(sim, rideId)).toBe(RideResult.NoEntrance);
    sim.enqueue({ type: 'placePath', x: 20, y: 18 });
    sim.enqueue({ type: 'placeRideEntrance', rideId, x: 20, y: 19 });
    sim.step();
    expect(open(sim, rideId)).toBe(RideResult.NoExit);
  });

  it('is refused when the test run was cancelled', () => {
    const { sim, rideId } = coasterWith();
    connectStation(sim, rideId);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    run(sim, 20);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'close' });
    sim.step();
    expect(open(sim, rideId)).toBe(RideResult.NotTested);
  });
});

describe('loading a save', () => {
  it('closes a tracked ride saved open without a passing test, and says why', () => {
    const { sim, rideId, slot } = coasterWith();
    connectStation(sim, rideId);
    sim.world.rides.cols.state[slot] = RideState.Open;
    const loaded = deserialize(serialize(sim.world));
    expect(loaded.rides.cols.state[loaded.rides.idToSlot[rideId]]).toBe(RideState.Closed);
    expect(loaded.feedback.domain).toBe(FeedbackDomain.Ride);
    expect(loaded.feedback.code).toBe(RideResult.NotTested);
  });

  it('keeps a valid open ride open', () => {
    const { sim, rideId, slot } = coasterWith();
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    run(sim, 9000);
    connectStation(sim, rideId);
    expect(open(sim, rideId)).toBe(RideResult.Ok);
    const loaded = deserialize(serialize(sim.world));
    expect(loaded.rides.cols.state[loaded.rides.idToSlot[rideId]]).toBe(RideState.Open);
    expect(sim.world.rides.cols.state[slot]).toBe(RideState.Open);
  });
});
