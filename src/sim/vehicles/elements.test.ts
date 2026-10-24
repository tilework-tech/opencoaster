import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { pieceByName } from '../track/catalog';
import { getConstructionCursor, placeTrack } from '../track/construction';
import { PieceMode, TrackResult } from '../track/track-types';
import { getTrainState, spawnTrain, VehicleState } from './vehicle-store';
import { stepVehicles } from './vehicle-system';
import { syncVehicleTracks, VehicleTrackRegistry } from './vehicle-track';

/** Runs a testing train over the named pieces (laid end to end) and returns what it measured. */
function measure(names: string[], speed: number) {
  const world = new World({ seed: 1, width: 64, height: 64, maxGuests: 32 });
  world.map.heights.fill(2);
  const rideId = world.rides.slotToId[world.rides.spawn()];
  names.forEach((name, i) => {
    const cursor = getConstructionCursor(world, rideId);
    const result = placeTrack(world, {
      rideId,
      pieceType: pieceByName(name)!.id,
      x: i === 0 ? 20 : cursor.x,
      y: i === 0 ? 20 : cursor.y,
      z: i === 0 ? 8 : cursor.z,
      dir: i === 0 ? 0 : cursor.dir,
      mode: PieceMode.Normal,
    });
    expect(result, name).toBe(TrackResult.Ok);
  });
  const tracks = new VehicleTrackRegistry();
  syncVehicleTracks(world, tracks);
  const train = spawnTrain(world, {
    rideId,
    state: VehicleState.Testing,
    speed,
    mass: 8000,
    carCount: 3,
  });
  for (let i = 0; i < 4000 && getTrainState(world, train).state === VehicleState.Testing; i++) {
    stepVehicles(world, tracks);
  }
  return getTrainState(world, train);
}

describe('track element forces', () => {
  it('turns the rider upside down in a corkscrew and counts one inversion', () => {
    const level = measure(['flat', 'flat', 'flat'], 1500);
    const corkscrew = measure(['flat', 'corkscrewRight', 'flat'], 1500);
    expect(level.minVerticalGQ8).toBe(256);
    expect(corkscrew.inversionCount).toBe(1);
    expect(corkscrew.minVerticalGQ8).toBeLessThan(0);
    expect(corkscrew.maxLateralGQ8).toBeGreaterThan(level.maxLateralGQ8);
  });

  it('presses the rider into the seat harder at speed in a corkscrew', () => {
    const slow = measure(['flat', 'corkscrewLeft', 'flat'], 800);
    const fast = measure(['flat', 'corkscrewLeft', 'flat'], 3500);
    expect(fast.minVerticalGQ8).toBeGreaterThan(slow.minVerticalGQ8);
  });

  it('puts less lateral force on an S-bend than on a small turn at the same speed', () => {
    const sBend = measure(['flat', 'sBendRight', 'flat'], 2500);
    const turn = measure(['flat', 'smallRight', 'flat'], 2500);
    expect(sBend.maxLateralGQ8).toBeGreaterThan(0);
    expect(sBend.maxLateralGQ8).toBeLessThan(turn.maxLateralGQ8);
  });

  it('loads the rider more than 1 G in a banked helix at speed', () => {
    const helix = measure(
      ['flat', 'flatToLeftBank', 'smallHelixLeftDown', 'leftBankToFlat', 'flat'],
      4500,
    );
    expect(helix.maxVerticalGQ8).toBeGreaterThan(300);
    expect(helix.inversionCount).toBe(0);
  });

  it('shares gravity between seat and side on banked slopes using the slope angle', () => {
    const flatBank = measure(['flat', 'flatToLeftBank', 'leftBank', 'leftBankToFlat', 'flat'], 900);
    const slopeBank = measure(
      [
        'flat',
        'flatToLeftBank',
        'leftBankFlatToDown25',
        'leftBankDown25',
        'leftBankDown25ToFlat',
        'leftBankToFlat',
        'flat',
      ],
      900,
    );
    expect(flatBank.maxLateralGQ8).toBeGreaterThan(170);
    expect(slopeBank.maxLateralGQ8).toBeGreaterThan(flatBank.maxLateralGQ8 - 30);
  });
});
