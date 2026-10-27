import { describe, expect, it } from 'vitest';
import { circuitStatus } from '../track/construction';
import { PieceMode } from '../track/track-types';
import { getTrackPath } from '../track/track-path';
import { VehicleSegmentFlag, createVehicleTrackFromPath } from '../vehicles/vehicle-track';
import {
  SMALL_CIRCUIT,
  buildCircuit,
  connectStation,
  createCoaster,
  flatOwnedSim,
  queueGuests,
  run,
} from './coaster-fixtures';
import { getRideTestMeasurements, isRideTested } from './ride-operations';
import { RideResult } from './ride-results';
import { RideState } from './ride-store';

const N = PieceMode.Normal;
const SEGMENTS_PER_PIECE = 8;

/** SMALL_CIRCUIT with a three-piece platform; the far leg grows by the two extra tiles. */
const LONG_PLATFORM_CIRCUIT: ReadonlyArray<readonly [string, PieceMode]> = [
  ['station', N],
  ['station', N],
  ['station', N],
  ...SMALL_CIRCUIT.slice(1, 9),
  ['down25ToFlat', N],
  ['flat', N],
  ['flat', N],
  ['flat', N],
  ['smallRight', N],
  ['flat', N],
  ['smallRight', N],
];

function longPlatformCoaster() {
  const sim = flatOwnedSim(1);
  const rideId = createCoaster(sim);
  buildCircuit(sim, rideId, LONG_PLATFORM_CIRCUIT);
  connectStation(sim, rideId);
  return { sim, rideId, slot: sim.world.rides.idToSlot[rideId] };
}

describe('a station with a multi-piece platform', () => {
  it('is one platform for the vehicle track', () => {
    const { sim, rideId } = longPlatformCoaster();
    expect(circuitStatus(sim.world, rideId).complete).toBe(true);
    const track = createVehicleTrackFromPath(sim.world, getTrackPath(sim.world, rideId)!);
    let starts = 0;
    for (const flags of track.segmentFlags) if (flags & VehicleSegmentFlag.Station) starts++;
    expect(starts).toBe(1);
    expect(track.stationSegment).toBe(0);
    expect(track.stationEndQ8).toBe(track.cumulativeLengthsQ8[track.stationEndSegment]);
    expect(track.stationEndSegment).toBe(3 * SEGMENTS_PER_PIECE);
  });

  it('is tested over the whole circuit, not the first piece of the platform', () => {
    const { sim, rideId } = longPlatformCoaster();
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    run(sim, 6000);
    expect(isRideTested(sim.world, rideId)).toBe(true);
    expect(sim.world.feedback.code).toBe(RideResult.TestPassed);
    const length = circuitStatus(sim.world, rideId).length;
    const measured = getRideTestMeasurements(sim.world, rideId)!;
    expect(measured.durationTicks).toBeGreaterThan(length / 16);
    expect(measured.dropCount).toBeGreaterThan(0);
  });

  it('carries guests round full laps once open', () => {
    const { sim, rideId, slot } = longPlatformCoaster();
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'test' });
    run(sim, 6000);
    sim.enqueue({ type: 'setRideStatus', rideId, status: 'open' });
    sim.step();
    expect(sim.world.rides.cols.state[slot]).toBe(RideState.Open);
    queueGuests(sim, rideId, 32);
    run(sim, 8000);
    expect(sim.world.rides.cols.cyclesCompleted[slot]).toBeGreaterThanOrEqual(2);
    expect(sim.world.rides.cols.guestsServed[slot]).toBeGreaterThanOrEqual(16);
  });
});
