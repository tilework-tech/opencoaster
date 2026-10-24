import { describe, expect, it } from 'vitest';
import { buildCircuit, createCoaster, flatOwnedSim, run } from './coaster-fixtures';
import { RideType } from './ride-types';
import { RideResult } from './ride-results';
import { VehicleState } from '../vehicles/vehicle-store';
import { findRideTrain } from '../vehicles/ride-trains';
import { PieceMode } from '../track/track-types';

const N = PieceMode.Normal;
const L = PieceMode.ChainLift;
const flats = (n: number) => Array.from({ length: n }, () => ['flat', N] as const);
const LOOP = [
  ['station', N],
  ['flatToUp25', L],
  ['up25', L],
  ['up25', L],
  ['up25', L],
  ['up25ToFlat', L],
  ...flats(4),
  ['smallRight', N],
  ['smallRight', N],
  ['flatToDown25', N],
  ['down25', N],
  ['down25', N],
  ['down25', N],
  ['down25ToFlat', N],
  ...flats(5),
  ['smallRight', N],
  ['smallRight', N],
] as Array<readonly [string, PieceMode]>;

describe('ride testing with a stalled train', () => {
  it('reports a stall as a stall rather than a generic test failure', () => {
    const sim = flatOwnedSim(1);
    const rideId = createCoaster(sim, RideType.SteelLoopingCoaster);
    buildCircuit(sim, rideId, LOOP);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    run(sim, 5);
    const train = findRideTrain(sim.world, rideId);
    expect(train).toBeGreaterThanOrEqual(0);
    sim.world.vehicles.cols.state[train] = VehicleState.Stalled;
    run(sim, 2);
    expect(sim.world.feedback.code).toBe(RideResult.TestStalled);
  });
});
