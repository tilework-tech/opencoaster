import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import type { Simulation } from '../core/simulation';
import { RideType } from '../rides/ride-types';
import { createCoaster, flatOwnedSim, buildCircuit } from '../rides/coaster-fixtures';
import { getTrainState, spawnTrain } from './vehicle-store';
import {
  COLLISION_SPEED_Q8,
  CREST_CRASH_SPEED_Q8,
  DROP_CRASH_SPEED_Q8,
  kmhToSpeedQ8,
  speedQ8ToKmh,
} from './speed-units';
import {
  VehicleSegmentFlag,
  VehicleState,
  VehicleTrackRegistry,
  createVehicleTrack,
  stepVehicles,
  syncVehicleTracks,
} from './vehicle-system';

const Q8 = 256;

function crestTrack(rideId = 0) {
  return new VehicleTrackRegistry([
    createVehicleTrack({
      rideId,
      points: Int32Array.of(0, 0, 0, 512, 0, 0),
      segmentFlags: Uint16Array.of(VehicleSegmentFlag.Crest),
    }),
  ]);
}

function stateAfterCrest(speedQ8: number) {
  const world = new World({ seed: 1, width: 16, height: 16, maxGuests: 8 });
  const train = spawnTrain(world, { rideId: 0, speed: speedQ8, state: VehicleState.Testing });
  stepVehicles(world, crestTrack());
  return getTrainState(world, train).state;
}

describe('crash speed scale', () => {
  it('converts the km/h limits at 5.1 km/h per unit per tick', () => {
    expect(CREST_CRASH_SPEED_Q8 / Q8).toBeCloseTo(9.8, 1);
    expect(DROP_CRASH_SPEED_Q8 / Q8).toBeCloseTo(12.55, 1);
    expect(COLLISION_SPEED_Q8 / Q8).toBeCloseTo(9.41, 1);
    expect(speedQ8ToKmh(kmhToSpeedQ8(64))).toBeCloseTo(64, 1);
  });

  it('crashes over a crest at 9.9 units per tick but not at 9.7 (tracks crash by default)', () => {
    expect(stateAfterCrest(Math.round(9.9 * Q8))).toBe(VehicleState.Crashed);
    expect(stateAfterCrest(Math.round(9.7 * Q8))).toBe(VehicleState.Testing);
  });

  it('crashes at the start of a drop above 64 km/h and not below it', () => {
    const run = (speed: number) => {
      const world = new World({ seed: 1, width: 16, height: 16, maxGuests: 8 });
      const registry = new VehicleTrackRegistry([
        createVehicleTrack({
          rideId: 0,
          points: Int32Array.of(0, 0, 8, 512, 0, 0),
          segmentFlags: Uint16Array.of(VehicleSegmentFlag.DropStart),
        }),
      ]);
      const train = spawnTrain(world, { rideId: 0, speed, state: VehicleState.Testing });
      stepVehicles(world, registry);
      return getTrainState(world, train).state;
    };
    expect(run(DROP_CRASH_SPEED_Q8 + 1)).toBe(VehicleState.Crashed);
    expect(run(DROP_CRASH_SPEED_Q8)).toBe(VehicleState.Testing);
  });

  it('crashes two trains meeting at 48 km/h combined and not below', () => {
    const meet = (each: number) => {
      const world = new World({ seed: 1, width: 16, height: 16, maxGuests: 8 });
      const registry = new VehicleTrackRegistry([
        createVehicleTrack({
          rideId: 0,
          points: Int32Array.of(0, 0, 0, 1024, 0, 0),
          segmentFlags: new Uint16Array(1),
        }),
      ]);
      const a = spawnTrain(world, { rideId: 0, speed: each, state: VehicleState.Running });
      spawnTrain(world, { rideId: 0, speed: each, state: VehicleState.Running });
      stepVehicles(world, registry);
      return getTrainState(world, a).state;
    };
    expect(meet(Math.ceil(COLLISION_SPEED_Q8 / 2))).toBe(VehicleState.Crashed);
    expect(meet(Math.floor(COLLISION_SPEED_Q8 / 2) - 1)).toBe(VehicleState.Running);
  });
});

describe('crash rules by ride type', () => {
  function trackFor(rideType: RideType) {
    const sim: Simulation = flatOwnedSim();
    const rideId = createCoaster(sim, rideType);
    buildCircuit(sim, rideId);
    const registry = new VehicleTrackRegistry();
    syncVehicleTracks(sim.world, registry);
    return registry.get(rideId)!;
  }

  it('lets wooden coaster cars crash at crests and drops', () => {
    const track = trackFor(RideType.WoodenCoaster);
    expect(track.crashable).toBe(true);
    expect(track.crestCrashSpeedQ8).toBe(CREST_CRASH_SPEED_Q8);
    expect(track.dropCrashSpeedQ8).toBe(DROP_CRASH_SPEED_Q8);
  });

  it('keeps steel coaster cars on the track at any crest or drop speed', () => {
    const track = trackFor(RideType.SteelLoopingCoaster);
    expect(track.crashable).toBe(true);
    expect(track.crestCrashSpeedQ8).toBeGreaterThan(100 * 256 * 256);
  });
});
