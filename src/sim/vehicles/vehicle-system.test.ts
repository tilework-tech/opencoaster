import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { hashWorld } from '../core/hash';
import { calculateTrackedRideRatings } from './vehicle-ratings';
import {
  createVehicleTrack,
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
    expect(heavyWorld.vehicles.cols.speed[heavy]).toBeGreaterThan(
      lightWorld.vehicles.cols.speed[light],
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

    expect(getTrainState(liftWorld, liftTrain).speed).toBeGreaterThan(0);
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
      track(0, [0, 0, 0, 256, 0, 0], [VehicleSegmentFlag.Station], { loop: true }),
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
      track(0, [0, 0, 0, 256, 0, 0], [VehicleSegmentFlag.Station], { loop: true }),
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

  it('records ride-test metrics and derives ratings from forces and track events', () => {
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

  it('lets ride length, airtime, and top speed contribute to tracked ratings', async () => {
    const baseline = calculateTrackedRideRatings({
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
    });
    const fasterLonger = calculateTrackedRideRatings({
      maxSpeed: 1024,
      averageSpeed: 512,
      dropCount: 0,
      highestDrop: 0,
      inversionCount: 0,
      maxVerticalGQ8: 256,
      minVerticalGQ8: 256,
      maxLateralGQ8: 0,
      rideLength: 100_000,
      airtimeTicks: 20,
    });
    expect(fasterLonger.excitement).toBeGreaterThan(baseline.excitement);
  });

  it('produces identical vehicle state for the same train and track inputs', () => {
    const run = () => {
      const simWorld = world();
      const simTrack = registry(
        track(
          0,
          [0, 0, 0, 256, 0, -32, 512, 0, -32, 768, 0, 0],
          [0, VehicleSegmentFlag.Launch, 0],
          { loop: true },
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
});
