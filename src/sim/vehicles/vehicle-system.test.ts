import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { hashWorld } from '../core/hash';
import { PieceId } from '../track/catalog';
import { getConstructionCursor, placeTrack } from '../track/construction';
import { getTrackPath } from '../track/track-path';
import { PieceMode, TrackResult } from '../track/track-types';
import { calculateTrackedRideRatings } from './vehicle-ratings';
import {
  createVehicleTrack,
  createVehicleTrackFromPath,
  VehicleSegmentFlag,
  VehicleState,
  VehicleTrackRegistry,
  vehicleSystem,
} from './vehicle-system';
import { getTrainState, spawnTrain } from './vehicle-store';
import { stepVehicles } from './vehicle-system';

function world() {
  return new World({ seed: 41, width: 16, height: 16, maxGuests: 32 });
}

function track(
  rideId: number,
  points: number[],
  flags: number[] = [],
  options: {
    lateralCurvatureQ8?: number[];
    verticalCurvatureQ8?: number[];
    blockOpen?: number[];
    loop?: boolean;
    crashable?: boolean;
    crestCrashSpeedQ8?: number;
    dropCrashSpeedQ8?: number;
    invertedSegments?: number[];
    bankSinQ8?: number[];
    bankCosQ8?: number[];
  } = {},
) {
  return createVehicleTrack({
    rideId,
    points: Int32Array.from(points),
    segmentFlags: flags.length ? Uint16Array.from(flags) : new Uint16Array(points.length / 3 - 1),
    lateralCurvatureQ8: options.lateralCurvatureQ8
      ? Int16Array.from(options.lateralCurvatureQ8)
      : undefined,
    verticalCurvatureQ8: options.verticalCurvatureQ8
      ? Int16Array.from(options.verticalCurvatureQ8)
      : undefined,
    blockOpen: options.blockOpen ? Uint8Array.from(options.blockOpen) : undefined,
    loop: options.loop ?? false,
    crashable: options.crashable,
    crestCrashSpeedQ8: options.crestCrashSpeedQ8,
    dropCrashSpeedQ8: options.dropCrashSpeedQ8,
    invertedSegments: options.invertedSegments
      ? Uint8Array.from(options.invertedSegments)
      : undefined,
    bankSinQ8: options.bankSinQ8 ? Int16Array.from(options.bankSinQ8) : undefined,
    bankCosQ8: options.bankCosQ8 ? Int16Array.from(options.bankCosQ8) : undefined,
  });
}

function registry(...tracks: ReturnType<typeof track>[]) {
  return new VehicleTrackRegistry(tracks);
}

describe('vehicle simulation', () => {
  it('accelerates downhill and loses speed while climbing', () => {
    const downhillWorld = world();
    const downhill = registry(track(0, [0, 0, 0, 256, 0, -128]));
    const downhillSlot = spawnTrain(downhillWorld, {
      rideId: 0,
      speed: 0,
      state: VehicleState.Running,
    });
    stepVehicles(downhillWorld, downhill);

    const uphillWorld = world();
    const flatWorld = world();
    const uphill = registry(track(0, [0, 0, 0, 256, 0, 128]));
    const flat = registry(track(0, [0, 0, 0, 256, 0, 0]));
    const uphillSlot = spawnTrain(uphillWorld, {
      rideId: 0,
      speed: 1024,
      state: VehicleState.Running,
    });
    const flatSlot = spawnTrain(flatWorld, { rideId: 0, speed: 1024, state: VehicleState.Running });
    stepVehicles(uphillWorld, uphill);
    stepVehicles(flatWorld, flat);

    expect(getTrainState(downhillWorld, downhillSlot).speed).toBeGreaterThan(0);
    expect(getTrainState(uphillWorld, uphillSlot).speed).toBeLessThan(
      getTrainState(flatWorld, flatSlot).speed,
    );
  });

  it('lets heavier trains retain more speed against rolling resistance', () => {
    const heavyWorld = world();
    const lightWorld = world();
    const flat = registry(track(0, [0, 0, 0, 4096, 0, 0]));
    const heavy = spawnTrain(heavyWorld, {
      rideId: 0,
      mass: 2048,
      speed: 2048,
      state: VehicleState.Running,
    });
    const light = spawnTrain(lightWorld, {
      rideId: 0,
      mass: 64,
      speed: 2048,
      state: VehicleState.Running,
    });
    stepVehicles(heavyWorld, flat);
    stepVehicles(lightWorld, flat);
    expect(getTrainState(heavyWorld, heavy).speed).toBeGreaterThan(
      getTrainState(lightWorld, light).speed,
    );
  });

  it('raises speed to a chain-lift target and accelerates on a launch segment', () => {
    const liftWorld = world();
    const liftTrack = registry(track(0, [0, 0, 0, 512, 0, 0], [VehicleSegmentFlag.ChainLift]));
    const liftTrain = spawnTrain(liftWorld, { rideId: 0, speed: 0, state: VehicleState.Running });
    stepVehicles(liftWorld, liftTrack);

    const launchWorld = world();
    const launchTrack = registry(track(0, [0, 0, 0, 512, 0, 0], [VehicleSegmentFlag.Launch]));
    const launchTrain = spawnTrain(launchWorld, {
      rideId: 0,
      speed: 512,
      state: VehicleState.Running,
    });
    stepVehicles(launchWorld, launchTrack);

    expect(getTrainState(liftWorld, liftTrain).speed).toBe(1280);
    expect(getTrainState(launchWorld, launchTrain).speed).toBeGreaterThan(512);
  });

  it('slows a train toward the brake target', () => {
    const brakeWorld = world();
    const brakeTrack = registry(track(0, [0, 0, 0, 512, 0, 0], [VehicleSegmentFlag.Brake]));
    const brakeTrain = spawnTrain(brakeWorld, {
      rideId: 0,
      speed: 2048,
      state: VehicleState.Running,
    });
    stepVehicles(brakeWorld, brakeTrack);
    expect(getTrainState(brakeWorld, brakeTrain).speed).toBeLessThan(2048);
  });

  it('holds at a closed block boundary and proceeds when the section opens', () => {
    const blockedWorld = world();
    const blocked = registry(
      track(0, [0, 0, 0, 256, 0, 0, 512, 0, -128], [0, VehicleSegmentFlag.Block], {
        blockOpen: [1, 0],
      }),
    );
    const blockedSlot = spawnTrain(blockedWorld, {
      rideId: 0,
      speed: 2048,
      state: VehicleState.Running,
      trackPos: 255,
    });
    stepVehicles(blockedWorld, blocked);
    expect(getTrainState(blockedWorld, blockedSlot).trackPos).toBe(256 << 8);
    expect(getTrainState(blockedWorld, blockedSlot).speed).toBe(0);
    blocked.set(
      track(0, [0, 0, 0, 256, 0, 0, 512, 0, -128], [0, VehicleSegmentFlag.Block], {
        blockOpen: [1, 1],
      }),
    );
    stepVehicles(blockedWorld, blocked);
    expect(getTrainState(blockedWorld, blockedSlot).trackPos).toBeGreaterThan(256 << 8);
    expect(getTrainState(blockedWorld, blockedSlot).speed).toBeLessThanOrEqual(4 * 256);
  });

  it('does not skip a closed block when one tick crosses several short segments', () => {
    const simWorld = world();
    const simTrack = registry(
      track(
        0,
        [0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 20, 0, 0],
        [0, VehicleSegmentFlag.Block, 0, 0],
        { blockOpen: [1, 0, 1, 1] },
      ),
    );
    const train = spawnTrain(simWorld, { rideId: 0, speed: 2048, state: VehicleState.Running });

    stepVehicles(simWorld, simTrack);

    expect(getTrainState(simWorld, train).trackPos).toBe(1 << 8);
    expect(getTrainState(simWorld, train).speed).toBe(0);
  });

  it('holds a train before an occupied block section', () => {
    const simWorld = world();
    const simTrack = registry(
      track(0, [0, 0, 0, 1, 0, 0, 20, 0, 0], [0, VehicleSegmentFlag.Block], {
        blockOpen: [1, 1],
      }),
    );
    const occupying = spawnTrain(simWorld, {
      rideId: 0,
      state: VehicleState.Running,
      trackPos: 4,
      speed: 0,
    });
    const approaching = spawnTrain(simWorld, {
      rideId: 0,
      state: VehicleState.Running,
      trackPos: 0,
      speed: 512,
    });

    stepVehicles(simWorld, simTrack);

    expect(getTrainState(simWorld, occupying).state).toBe(VehicleState.Running);
    expect(getTrainState(simWorld, approaching).trackPos).toBe(1 << 8);
    expect(getTrainState(simWorld, approaching).speed).toBe(0);

    const clearWorld = world();
    const clearTrack = registry(
      track(0, [0, 0, 0, 1, 0, 0, 20, 0, 0], [0, VehicleSegmentFlag.Block]),
    );
    const clearTrain = spawnTrain(clearWorld, {
      rideId: 0,
      state: VehicleState.Running,
      speed: 512,
    });
    stepVehicles(clearWorld, clearTrack);
    expect(getTrainState(clearWorld, clearTrain).trackPos).toBeGreaterThan(1 << 8);
  });

  it('keeps a contiguous multi-segment block reserved while a train occupies it', () => {
    const simWorld = world();
    const simTrack = registry(
      track(
        0,
        [0, 0, 0, 1, 0, 0, 10, 0, 0, 20, 0, 0, 30, 0, 0],
        [0, VehicleSegmentFlag.Block, VehicleSegmentFlag.Block, 0],
        { blockOpen: [1, 1, 1, 1] },
      ),
    );
    spawnTrain(simWorld, {
      rideId: 0,
      trackPos: 15,
      speed: 0,
      state: VehicleState.Running,
    });
    const approaching = spawnTrain(simWorld, {
      rideId: 0,
      speed: 512,
      state: VehicleState.Running,
    });

    stepVehicles(simWorld, simTrack);

    expect(getTrainState(simWorld, approaching).trackPos).toBe(1 << 8);
    expect(getTrainState(simWorld, approaching).speed).toBe(0);
  });

  it('reserves a block section when a train enters it during the current tick', () => {
    const simWorld = world();
    const simTrack = registry(
      track(0, [0, 0, 0, 1, 0, 0, 21, 0, 0, 100, 0, 0], [0, VehicleSegmentFlag.Block, 0]),
    );
    const first = spawnTrain(simWorld, {
      rideId: 0,
      speed: 512,
      state: VehicleState.Running,
    });
    const second = spawnTrain(simWorld, {
      rideId: 0,
      speed: 512,
      state: VehicleState.Running,
    });

    stepVehicles(simWorld, simTrack);

    expect(getTrainState(simWorld, first).trackPos).toBeGreaterThan(1 << 8);
    expect(getTrainState(simWorld, second).trackPos).toBe(1 << 8);
    expect(getTrainState(simWorld, second).speed).toBe(0);
  });

  it('dispatches from the station when maximum wait expires', () => {
    const stationWorld = world();
    const stationTrack = registry(
      track(0, [0, 0, 0, 256, 0, 0, 0, 0, 0], [VehicleSegmentFlag.Station, 0], { loop: true }),
    );
    const waiting = spawnTrain(stationWorld, {
      rideId: 0,
      state: VehicleState.Waiting,
      passengers: 0,
      capacity: 4,
      maxWaitTicks: 3,
    });
    stepVehicles(stationWorld, stationTrack);
    expect(getTrainState(stationWorld, waiting).state).toBe(VehicleState.Waiting);
    stepVehicles(stationWorld, stationTrack);
    expect(getTrainState(stationWorld, waiting).state).toBe(VehicleState.Waiting);
    stepVehicles(stationWorld, stationTrack);
    expect(getTrainState(stationWorld, waiting).state).toBe(VehicleState.Running);
  });

  it('respects minimum station wait even when the train is full', () => {
    const stationWorld = world();
    stationWorld.vehicleTracks = registry(
      track(0, [0, 0, 0, 256, 0, 0, 0, 0, 0], [VehicleSegmentFlag.Station, 0], { loop: true }),
    );
    const waiting = spawnTrain(stationWorld, {
      rideId: 0,
      state: VehicleState.Waiting,
      passengers: 4,
      capacity: 4,
      minWaitTicks: 3,
    });
    vehicleSystem.update(stationWorld);
    vehicleSystem.update(stationWorld);
    expect(getTrainState(stationWorld, waiting).state).toBe(VehicleState.Waiting);
    vehicleSystem.update(stationWorld);
    expect(getTrainState(stationWorld, waiting).state).toBe(VehicleState.Running);
  });

  it('marks a gravity test as stalled when the train cannot climb', () => {
    const stalledWorld = world();
    const uphill = registry(track(0, [0, 0, 0, 256, 0, 128]));
    const train = spawnTrain(stalledWorld, {
      rideId: 0,
      state: VehicleState.Testing,
    });
    for (let tick = 0; tick < 81; tick++) stepVehicles(stalledWorld, uphill);
    expect(getTrainState(stalledWorld, train).state).toBe(VehicleState.Stalled);
  });

  it('records ride-test metrics and writes ratings by stable ride ID after slot compaction', () => {
    const simWorld = world();
    simWorld.rides.spawn();
    const rideId = simWorld.rides.spawn();
    simWorld.rides.despawnId(0);
    const rideSlot = simWorld.rides.idToSlot[rideId];
    const rideTrack = registry(
      track(
        rideId,
        [0, 0, 0, 256, 0, -128, 512, 0, 0, 768, 0, 0],
        [VehicleSegmentFlag.DropStart, VehicleSegmentFlag.Inversion, VehicleSegmentFlag.Crest],
        { lateralCurvatureQ8: [128, 0, 0], verticalCurvatureQ8: [128, -512, 0], loop: false },
      ),
    );
    const trackDefinition = rideTrack.get(rideId)!;
    const slot = spawnTrain(simWorld, {
      rideId,
      speed: 4096,
      state: VehicleState.Testing,
      mass: 512,
    });
    for (
      let tick = 0;
      tick < 120 && simWorld.vehicles.cols.state[slot] === VehicleState.Testing;
      tick++
    ) {
      stepVehicles(simWorld, rideTrack);
    }

    const completed = getTrainState(simWorld, slot);
    expect(completed.state).toBe(VehicleState.TestComplete);
    expect(completed.maxSpeed).toBeGreaterThan(0);
    expect(completed.averageSpeed).toBeGreaterThan(0);
    expect(completed.rideLength).toBeGreaterThan(0);
    expect(completed.rideLength).toBe(trackDefinition.totalLengthQ8);
    expect(completed.rideTimeTicks).toBeGreaterThan(0);
    expect(completed.dropCount).toBe(1);
    expect(completed.inversionCount).toBe(1);
    expect(completed.airtimeTicks).toBeGreaterThan(0);
    expect(completed.maxVerticalGQ8).toBeGreaterThan(0);
    expect(completed.minVerticalGQ8).toBeLessThan(0);
    expect(completed.maxLateralGQ8).toBeGreaterThan(0);
    expect(completed.excitement).toBeGreaterThan(0);
    expect(completed.intensity).toBeGreaterThan(0);
    expect(completed.nausea).toBeGreaterThan(0);
    expect(simWorld.rides.cols.excitement[rideSlot]).toBe(completed.excitement);
    expect(simWorld.rides.cols.intensity[rideSlot]).toBe(completed.intensity);
    expect(simWorld.rides.cols.nausea[rideSlot]).toBe(completed.nausea);
  });

  it('includes tracked-ride ratings in deterministic world hashes', () => {
    const first = world();
    const second = world();
    first.rides.spawn();
    second.rides.spawn();
    for (const rating of ['excitement', 'intensity', 'nausea'] as const) {
      second.rides.cols[rating][0] = 1;
      expect(hashWorld(first)).not.toBe(hashWorld(second));
      second.rides.cols[rating][0] = 0;
    }
  });

  it('crashes only above the configured speed on a crest or drop start', () => {
    const crashWorld = world();
    const crashTrack = registry(
      track(0, [0, 0, 0, 512, 0, 0], [VehicleSegmentFlag.Crest], { crashable: true }),
    );
    const crashed = spawnTrain(crashWorld, {
      rideId: 0,
      speed: 15000,
      state: VehicleState.Testing,
    });
    stepVehicles(crashWorld, crashTrack);
    expect(getTrainState(crashWorld, crashed).state).toBe(VehicleState.Crashed);

    const thresholdWorld = world();
    const atThreshold = spawnTrain(thresholdWorld, {
      rideId: 0,
      speed: 50 * 256,
      state: VehicleState.Testing,
    });
    const aboveThreshold = spawnTrain(thresholdWorld, {
      rideId: 0,
      trackPos: 1,
      speed: 50 * 256 + 1,
      state: VehicleState.Testing,
    });
    stepVehicles(thresholdWorld, crashTrack);
    expect(getTrainState(thresholdWorld, atThreshold).state).toBe(VehicleState.Testing);
    expect(getTrainState(thresholdWorld, aboveThreshold).state).toBe(VehicleState.Crashed);

    const safeWorld = world();
    const safe = spawnTrain(safeWorld, { rideId: 0, speed: 1000, state: VehicleState.Testing });
    stepVehicles(safeWorld, crashTrack);
    expect(getTrainState(safeWorld, safe).state).toBe(VehicleState.Testing);

    const fastFlatWorld = world();
    const fastFlat = spawnTrain(fastFlatWorld, {
      rideId: 0,
      speed: 15000,
      state: VehicleState.Testing,
    });
    stepVehicles(fastFlatWorld, registry(track(0, [0, 0, 0, 512, 0, 0])));
    expect(getTrainState(fastFlatWorld, fastFlat).state).toBe(VehicleState.Testing);

    const dropWorld = world();
    const dropStart = spawnTrain(dropWorld, {
      rideId: 0,
      speed: 80 * 256 + 1,
      state: VehicleState.Testing,
    });
    stepVehicles(
      dropWorld,
      registry(
        track(0, [0, 0, 0, 512, 0, 0], [VehicleSegmentFlag.DropStart], {
          crashable: true,
          dropCrashSpeedQ8: 80 * 256,
        }),
      ),
    );
    expect(getTrainState(dropWorld, dropStart).state).toBe(VehicleState.Crashed);

    const safeDropWorld = world();
    const safeDrop = spawnTrain(safeDropWorld, {
      rideId: 0,
      speed: 70 * 256,
      state: VehicleState.Testing,
    });
    stepVehicles(
      safeDropWorld,
      registry(
        track(0, [0, 0, 0, 512, 0, 0], [VehicleSegmentFlag.DropStart], {
          crashable: true,
          dropCrashSpeedQ8: 80 * 256,
        }),
      ),
    );
    expect(getTrainState(safeDropWorld, safeDrop).state).toBe(VehicleState.Testing);

    const defaultTrackWorld = world();
    const defaultTrackTrain = spawnTrain(defaultTrackWorld, {
      rideId: 0,
      speed: 15000,
      state: VehicleState.Testing,
    });
    stepVehicles(
      defaultTrackWorld,
      registry(track(0, [0, 0, 0, 512, 0, 0], [VehicleSegmentFlag.Crest])),
    );
    expect(getTrainState(defaultTrackWorld, defaultTrackTrain).state).toBe(VehicleState.Testing);
  });

  it('crashes colliding trains when their combined speed exceeds the safety threshold', () => {
    const simWorld = world();
    const simTrack = registry(track(0, [0, 0, 0, 1024, 0, 0], [], { crashable: true }));
    const first = spawnTrain(simWorld, { rideId: 0, speed: 7000, state: VehicleState.Running });
    const second = spawnTrain(simWorld, { rideId: 0, speed: 7000, state: VehicleState.Running });
    stepVehicles(simWorld, simTrack);
    expect(getTrainState(simWorld, first).state).toBe(VehicleState.Crashed);
    expect(getTrainState(simWorld, second).state).toBe(VehicleState.Crashed);

    const slowWorld = world();
    const slowTrack = registry(track(0, [0, 0, 0, 1024, 0, 0], [], { crashable: true }));
    const slowFirst = spawnTrain(slowWorld, {
      rideId: 0,
      speed: 1000,
      state: VehicleState.Running,
    });
    const slowSecond = spawnTrain(slowWorld, {
      rideId: 0,
      speed: 1000,
      state: VehicleState.Running,
    });
    stepVehicles(slowWorld, slowTrack);
    expect(getTrainState(slowWorld, slowFirst).state).toBe(VehicleState.Running);
    expect(getTrainState(slowWorld, slowSecond).state).toBe(VehicleState.Running);
  });

  it('does not crash trains that are separated on the same long segment', () => {
    const simWorld = world();
    const simTrack = registry(track(0, [0, 0, 0, 1000, 0, 0], [], { crashable: true }));
    const first = spawnTrain(simWorld, {
      rideId: 0,
      trackPos: 100,
      speed: 7000,
      state: VehicleState.Running,
    });
    const second = spawnTrain(simWorld, {
      rideId: 0,
      trackPos: 500,
      speed: 7000,
      state: VehicleState.Running,
    });

    stepVehicles(simWorld, simTrack);

    expect(getTrainState(simWorld, first).state).toBe(VehicleState.Running);
    expect(getTrainState(simWorld, second).state).toBe(VehicleState.Running);
  });

  it('crashes trains when a faster train catches the one ahead during the tick', () => {
    const simWorld = world();
    const simTrack = registry(track(0, [0, 0, 0, 1000, 0, 0], [], { crashable: true }));
    const ahead = spawnTrain(simWorld, {
      rideId: 0,
      trackPos: 102,
      speed: 6000,
      state: VehicleState.Running,
    });
    const behind = spawnTrain(simWorld, {
      rideId: 0,
      trackPos: 100,
      speed: 7000,
      state: VehicleState.Running,
    });

    stepVehicles(simWorld, simTrack);

    expect(getTrainState(simWorld, ahead).state).toBe(VehicleState.Crashed);
    expect(getTrainState(simWorld, behind).state).toBe(VehicleState.Crashed);
  });

  it('does not crash a faster train that is pulling away ahead of a slower train', () => {
    const simWorld = world();
    const simTrack = registry(track(0, [0, 0, 0, 1000, 0, 0], [], { crashable: true }));
    const leader = spawnTrain(simWorld, {
      rideId: 0,
      trackPos: 102,
      speed: 7000,
      state: VehicleState.Running,
    });
    const follower = spawnTrain(simWorld, {
      rideId: 0,
      trackPos: 100,
      speed: 6000,
      state: VehicleState.Running,
    });

    stepVehicles(simWorld, simTrack);

    expect(getTrainState(simWorld, leader).state).toBe(VehicleState.Running);
    expect(getTrainState(simWorld, follower).state).toBe(VehicleState.Running);
  });

  it('records drop and inversion events crossed within one tick', () => {
    const simWorld = world();
    const simTrack = registry(
      track(
        0,
        [0, 0, 0, 1, 0, 0, 2, 0, -1, 3, 0, -1, 4, 0, -1, 5, 0, 0, 6, 0, 0],
        [0, VehicleSegmentFlag.DropStart, VehicleSegmentFlag.Inversion, 0, 0, 0],
      ),
    );
    const train = spawnTrain(simWorld, {
      rideId: 0,
      speed: 3 * 256,
      state: VehicleState.Testing,
    });

    stepVehicles(simWorld, simTrack);

    expect(getTrainState(simWorld, train).dropCount).toBe(1);
    expect(getTrainState(simWorld, train).inversionCount).toBe(1);
  });

  it('reports the full height of a drop spanning multiple descending segments', () => {
    const simWorld = world();
    const simTrack = registry(
      track(
        0,
        [0, 0, 10, 1, 0, 8, 2, 0, 5, 3, 0, 6, 10, 0, 6],
        [VehicleSegmentFlag.DropStart, 0, 0, 0],
      ),
    );
    const train = spawnTrain(simWorld, {
      rideId: 0,
      speed: 4096,
      state: VehicleState.Testing,
    });

    stepVehicles(simWorld, simTrack);

    expect(getTrainState(simWorld, train).highestDrop).toBe(5);
  });

  it('normalizes curvature acceleration into Q8 G force units', () => {
    const simWorld = world();
    const simTrack = registry(track(0, [0, 0, 0, 100, 0, 0], [], { lateralCurvatureQ8: [256] }));
    const train = spawnTrain(simWorld, {
      rideId: 0,
      speed: 256,
      state: VehicleState.Testing,
    });

    stepVehicles(simWorld, simTrack);

    expect(getTrainState(simWorld, train).maxLateralGQ8).toBeGreaterThanOrEqual(1900);
    expect(getTrainState(simWorld, train).maxLateralGQ8).toBeLessThanOrEqual(1950);
  });

  it('requires loop tracks to return to their starting point', () => {
    expect(() => track(0, [0, 0, 0, 10, 0, 0], [], { loop: true })).toThrow();
  });

  it('detects collisions across the seam of a closed loop', () => {
    const simWorld = world();
    const simTrack = registry(
      track(0, [0, 0, 0, 50, 0, 0, 100, 0, 0, 0, 0, 0], [0, 0, 0], { crashable: true, loop: true }),
    );
    const leader = spawnTrain(simWorld, {
      rideId: 0,
      trackPos: 1,
      speed: 6000,
      state: VehicleState.Running,
    });
    const follower = spawnTrain(simWorld, {
      rideId: 0,
      trackPos: 199,
      speed: 7000,
      state: VehicleState.Running,
    });

    stepVehicles(simWorld, simTrack);

    expect(getTrainState(simWorld, leader).state).toBe(VehicleState.Crashed);
    expect(getTrainState(simWorld, follower).state).toBe(VehicleState.Crashed);
  });

  it('detects a loop catch along the forward gap when the reverse gap is shorter', () => {
    const simWorld = world();
    const simTrack = registry(
      track(0, [0, 0, 0, 10, 0, 0, 0, 0, 0], [0, 0], { crashable: true, loop: true }),
    );
    const leader = spawnTrain(simWorld, {
      rideId: 0,
      trackPos: 1 * 256,
      speed: 4000,
      state: VehicleState.Running,
    });
    const follower = spawnTrain(simWorld, {
      rideId: 0,
      trackPos: 2 * 256,
      speed: 15000,
      state: VehicleState.Running,
    });

    stepVehicles(simWorld, simTrack);

    expect(getTrainState(simWorld, leader).state).toBe(VehicleState.Crashed);
    expect(getTrainState(simWorld, follower).state).toBe(VehicleState.Crashed);
  });

  it('samples force extrema on short intermediate segments crossed within a tick', () => {
    const simWorld = world();
    const simTrack = registry(
      track(0, [0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 20, 0, 0], [0, 0, 0, 0], {
        lateralCurvatureQ8: [0, 256, 0, 0],
      }),
    );
    const train = spawnTrain(simWorld, {
      rideId: 0,
      speed: 8 * 256,
      state: VehicleState.Testing,
    });

    stepVehicles(simWorld, simTrack);

    expect(getTrainState(simWorld, train).maxLateralGQ8).toBeGreaterThan(0);
  });

  it('measures each drop from its local preceding crest', () => {
    const simTrack = track(
      0,
      [0, 0, 20, 10, 0, 0, 20, 0, 0, 30, 0, 5, 40, 0, 2, 50, 0, 2],
      [0, VehicleSegmentFlag.DropStart, 0, VehicleSegmentFlag.DropStart, 0],
    );

    expect(simTrack.dropHeights[1]).toBe(20);
    expect(simTrack.dropHeights[3]).toBe(3);
  });

  it('records negative vertical G on a straight inverted segment', () => {
    const simWorld = world();
    const simTrack = registry(
      track(0, [0, 0, 0, 100, 0, 0], [VehicleSegmentFlag.Inversion], {
        invertedSegments: [1],
      }),
    );
    const train = spawnTrain(simWorld, {
      rideId: 0,
      speed: 256,
      state: VehicleState.Testing,
    });

    stepVehicles(simWorld, simTrack);

    expect(getTrainState(simWorld, train).minVerticalGQ8).toBe(-256);
    expect(getTrainState(simWorld, train).airtimeTicks).toBe(1);
  });

  it('flips vertical curvature force with inverted track orientation', () => {
    const simWorld = world();
    const simTrack = registry(
      track(0, [0, 0, 0, 100, 0, 0], [], {
        verticalCurvatureQ8: [32],
        invertedSegments: [1],
      }),
    );
    const train = spawnTrain(simWorld, {
      rideId: 0,
      speed: 256,
      state: VehicleState.Testing,
    });

    stepVehicles(simWorld, simTrack);

    expect(getTrainState(simWorld, train).minVerticalGQ8).toBeLessThan(-450);
  });

  it('clamps train speed inputs to the stored fixed-point range', () => {
    const simWorld = world();
    const simTrack = registry(track(0, [0, 0, 0, 100, 0, 0]));
    const train = spawnTrain(simWorld, {
      rideId: 0,
      speed: 70_000,
      state: VehicleState.Testing,
    });

    stepVehicles(simWorld, simTrack);

    expect(getTrainState(simWorld, train).maxSpeed).toBe(0xffff);
  });

  it('keeps inversion event counts separate from sustained inverted orientation', () => {
    const simWorld = world();
    const simTrack = registry(
      track(0, [0, 0, 0, 1, 0, 0, 2, 0, 0, 100, 0, 0], [VehicleSegmentFlag.Inversion, 0, 0], {
        invertedSegments: [0, 1, 0],
      }),
    );
    const train = spawnTrain(simWorld, {
      rideId: 0,
      speed: 8 * 256,
      state: VehicleState.Testing,
    });

    stepVehicles(simWorld, simTrack);

    expect(getTrainState(simWorld, train).inversionCount).toBe(1);
    expect(getTrainState(simWorld, train).minVerticalGQ8).toBe(-256);
  });

  it('keeps intermediate segment speed peaks in ride-test maximum speed', () => {
    const simWorld = world();
    const simTrack = registry(
      track(
        0,
        [0, 0, 0, 1, 0, 0, 101, 0, 0],
        [VehicleSegmentFlag.Launch, VehicleSegmentFlag.Brake],
      ),
    );
    const train = spawnTrain(simWorld, {
      rideId: 0,
      speed: 4000,
      state: VehicleState.Testing,
    });

    stepVehicles(simWorld, simTrack);

    const state = getTrainState(simWorld, train);
    expect(state.maxSpeed).toBeGreaterThan(4000);
    expect(state.maxSpeed).toBeGreaterThan(state.speed);
  });

  it('reduces lateral G when bank angle matches the centripetal load', () => {
    const unbankedWorld = world();
    const bankedWorld = world();
    const points = [0, 0, 0, 100, 0, 0];
    const unbankedTrack = registry(track(0, points, [], { lateralCurvatureQ8: [32] }));
    const bankedTrack = registry(
      track(0, points, [], {
        lateralCurvatureQ8: [32],
        bankSinQ8: [170],
        bankCosQ8: [181],
      }),
    );
    const unbanked = spawnTrain(unbankedWorld, {
      rideId: 0,
      speed: 256,
      state: VehicleState.Testing,
    });
    const banked = spawnTrain(bankedWorld, {
      rideId: 0,
      speed: 256,
      state: VehicleState.Testing,
    });

    stepVehicles(unbankedWorld, unbankedTrack);
    stepVehicles(bankedWorld, bankedTrack);

    expect(getTrainState(bankedWorld, banked).maxLateralGQ8).toBeLessThan(
      getTrainState(unbankedWorld, unbanked).maxLateralGQ8,
    );
  });

  it('applies slope gravity when the train crosses into a slope during the tick', () => {
    const run = (points: number[]) => {
      const simWorld = world();
      const simTrack = registry(track(0, points));
      const train = spawnTrain(simWorld, {
        rideId: 0,
        speed: 3 * 256,
        state: VehicleState.Running,
      });
      stepVehicles(simWorld, simTrack);
      return getTrainState(simWorld, train).speed;
    };

    const flatSpeed = run([0, 0, 0, 1, 0, 0, 2, 0, 0, 20, 0, 0]);
    const downhillSpeed = run([0, 0, 0, 1, 0, 0, 2, 0, -1, 20, 0, -1]);
    expect(downhillSpeed).toBeGreaterThan(flatSpeed);
  });

  it('lets ride length, airtime, and top speed contribute to tracked ratings', () => {
    const baseMetrics = {
      maxSpeed: 0,
      averageSpeed: 0,
      dropCount: 0,
      highestDrop: 0,
      inversionCount: 0,
      maxVerticalGQ8: 256,
      minVerticalGQ8: 256,
      maxLateralGQ8: 0,
      rideLength: 0,
      airtimeTicks: 0,
    };
    const baseline = calculateTrackedRideRatings(baseMetrics);
    const faster = calculateTrackedRideRatings({
      ...baseMetrics,
      maxSpeed: 1024,
      averageSpeed: 512,
    });
    const longer = calculateTrackedRideRatings({ ...baseMetrics, rideLength: 100_000 });
    const airtime = calculateTrackedRideRatings({ ...baseMetrics, airtimeTicks: 20 });
    expect(faster.excitement).toBeGreaterThan(baseline.excitement);
    expect(longer.excitement).toBeGreaterThan(baseline.excitement);
    expect(airtime.excitement).toBeGreaterThan(baseline.excitement);
  });

  it('produces identical vehicle state for the same train and track inputs', () => {
    const run = () => {
      const simWorld = world();
      const simTrack = registry(
        track(
          0,
          [0, 0, 0, 256, 0, -32, 512, 0, -32, 768, 0, 0, 0, 0, 0],
          [0, VehicleSegmentFlag.Launch, 0, 0],
          {
            lateralCurvatureQ8: [128, 0, 0, 0],
            verticalCurvatureQ8: [128, -512, 0, 0],
            loop: true,
          },
        ),
      );
      spawnTrain(simWorld, { rideId: 0, speed: 1024, state: VehicleState.Testing });
      for (let tick = 0; tick < 80; tick++) stepVehicles(simWorld, simTrack);
      const state = getTrainState(simWorld, 0);
      return [
        hashWorld(simWorld),
        state.trackPos,
        state.speed,
        state.state,
        state.rideLength,
        state.excitement,
        state.intensity,
        state.nausea,
      ];
    };

    expect(run()).toEqual(run());
  });

  it('builds vehicle paths from placed track during the vehicle system update', () => {
    const simWorld = world();
    const rideId = simWorld.rides.slotToId[simWorld.rides.spawn()];
    const cursor = getConstructionCursor(simWorld, rideId);
    expect(
      placeTrack(simWorld, {
        rideId,
        pieceType: PieceId.Station,
        x: 5,
        y: 5,
        z: 4,
        dir: 0,
        mode: PieceMode.Normal,
      }),
    ).toBe(TrackResult.Ok);
    expect(cursor.hasTrack).toBe(false);
    const next = getConstructionCursor(simWorld, rideId);
    expect(
      placeTrack(simWorld, {
        rideId,
        pieceType: PieceId.Flat,
        x: next.x,
        y: next.y,
        z: next.z,
        dir: next.dir,
        mode: PieceMode.ChainLift,
      }),
    ).toBe(TrackResult.Ok);
    const sourcePath = getTrackPath(simWorld, rideId)!;
    const train = spawnTrain(simWorld, {
      rideId,
      speed: 256,
      state: VehicleState.Running,
    });

    vehicleSystem.update(simWorld);

    expect(getTrainState(simWorld, train).trackPos).toBeGreaterThan(0);
    const vehicleTrack = simWorld.vehicleTracks?.get(rideId);
    expect(vehicleTrack?.sourceVersion).toBe(simWorld.track.version[rideId]);
    const liftStart = sourcePath.pieceStart[1];
    expect(vehicleTrack!.segmentFlags[liftStart - 1] & VehicleSegmentFlag.ChainLift).toBe(0);
    expect(vehicleTrack!.segmentFlags[liftStart] & VehicleSegmentFlag.ChainLift).not.toBe(0);
  });

  it('derives inverted orientation only along the inverted part of a vertical loop', () => {
    const simWorld = new World({ seed: 1, width: 64, height: 64, maxGuests: 32 });
    simWorld.map.heights.fill(2);
    const rideId = simWorld.rides.slotToId[simWorld.rides.spawn()];
    const put = (pieceType: number, mode = PieceMode.Normal, start?: [number, number, number]) => {
      const cursor = getConstructionCursor(simWorld, rideId);
      const [x, y, z] = start ?? [cursor.x, cursor.y, cursor.z];
      expect(
        placeTrack(simWorld, {
          rideId,
          pieceType,
          x,
          y,
          z,
          dir: cursor.dir,
          mode,
        }),
      ).toBe(TrackResult.Ok);
    };
    put(PieceId.Station, PieceMode.Normal, [20, 20, 6]);
    put(PieceId.FlatToUp25, PieceMode.ChainLift);
    put(PieceId.Up25, PieceMode.ChainLift);
    put(PieceId.Up25ToUp60);
    put(PieceId.Up60);
    put(PieceId.Up60ToUp25);
    put(PieceId.Up25ToFlat);
    put(PieceId.FlatToDown25);
    put(PieceId.Down25ToDown60);
    put(PieceId.Down60);
    put(PieceId.Down60ToDown25);
    put(PieceId.Down25ToFlat);
    put(PieceId.VerticalLoopLeft);

    const path = getTrackPath(simWorld, rideId)!;
    const vehicleTrack = createVehicleTrackFromPath(simWorld, path);
    const loopStart = path.pieceStart[12];
    const loopEnd = path.pieceStart[13];
    const loopOrientation = Array.from(vehicleTrack.invertedSegments.slice(loopStart, loopEnd - 1));

    expect(vehicleTrack.invertedSegments[loopStart]).toBe(0);
    expect(loopOrientation).toContain(1);
    expect(vehicleTrack.invertedSegments[loopEnd - 2]).toBe(0);
  });
});
