import { describe, expect, it } from 'vitest';
import {
  buildCircuit,
  connectStation,
  createCoaster,
  flatOwnedSim,
  run,
} from '../rides/coaster-fixtures';
import { isRideTested } from '../rides/ride-operations';
import { RideResult } from '../rides/ride-results';
import { liftStalledClimbs } from './stall-repair';
import { PieceMode } from './track-types';

const N = PieceMode.Normal;

/** Climbs once with no lift and has too little speed left at the top, then rolls on. */
const UNLIFTED_HILL: ReadonlyArray<readonly [string, PieceMode]> = [
  ['station', N],
  ['flatToUp25', N],
  ['up25', N],
  ['up25ToFlat', N],
  ['smallRight', N],
  ['flat', N],
  ['smallRight', N],
  ['flatToDown25', N],
  ['down25', N],
  ['down25ToFlat', N],
  ['flat', N],
  ['smallRight', N],
  ['flat', N],
  ['smallRight', N],
];

function chainPieces(sim: ReturnType<typeof flatOwnedSim>, rideId: number): number {
  const pieces = sim.world.track.pieces;
  let count = 0;
  for (let s = 0; s < pieces.count; s++)
    if (pieces.cols.rideId[s] === rideId && pieces.cols.mode[s] === PieceMode.ChainLift) count++;
  return count;
}

describe('lifting the climbs a train cannot make', () => {
  it('chain-lifts the hill that stalls an empty train so the test run completes', () => {
    const sim = flatOwnedSim();
    const rideId = createCoaster(sim);
    buildCircuit(sim, rideId, UNLIFTED_HILL);
    connectStation(sim, rideId);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    run(sim, 12_000);
    expect(isRideTested(sim.world, rideId)).toBe(false);
    expect(sim.world.feedback.code).toBe(RideResult.TestStalled);

    liftStalledClimbs(sim.world, rideId);

    expect(chainPieces(sim, rideId)).toBeGreaterThan(0);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    run(sim, 12_000);
    expect(isRideTested(sim.world, rideId)).toBe(true);
  });

  it('leaves a ride whose train already completes the lap as built', () => {
    const sim = flatOwnedSim();
    const rideId = createCoaster(sim);
    buildCircuit(sim, rideId);
    const tick = sim.world.tick;
    const before = chainPieces(sim, rideId);

    liftStalledClimbs(sim.world, rideId);

    expect(chainPieces(sim, rideId)).toBe(before);
    expect(sim.world.tick).toBe(tick);
    expect(sim.world.vehicles.count).toBe(0);
  });
});
