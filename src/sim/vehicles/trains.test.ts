import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import {
  CAR_LENGTH_Q8,
  VehicleSegmentFlag,
  VehicleTrackRegistry,
  createVehicleTrack,
  stepVehicles,
} from './vehicle-system';
import { VehicleState, getTrainState, spawnTrain } from './vehicle-store';
import { trainLimit } from './train-limit';

const blockLimit = (track: ReturnType<typeof squareLoop>) =>
  trainLimit({
    blockSectioned: true,
    sections: track.boundariesQ8.length,
    loop: track.loop,
    cars: 1,
    trackLengthQ8: track.totalLengthQ8,
  });

const Q8 = 256;
const STATION = VehicleSegmentFlag.Station | VehicleSegmentFlag.StationDrive;
const BLOCK = VehicleSegmentFlag.Block;

function world() {
  return new World({ seed: 5, width: 16, height: 16, maxGuests: 32 });
}

/** A flat square loop of 16 segments of 256 units; flags are given per segment index. */
function squareLoop(flags: Record<number, number>) {
  const corners = [
    [0, 0],
    [1024, 0],
    [1024, 1024],
    [0, 1024],
  ];
  const points: number[] = [];
  for (let side = 0; side < 4; side++) {
    const [x0, y0] = corners[side];
    const [x1, y1] = corners[(side + 1) % 4];
    for (let i = 0; i < 4; i++) {
      points.push(x0 + ((x1 - x0) * i) / 4, y0 + ((y1 - y0) * i) / 4, 0);
    }
  }
  points.push(0, 0, 0);
  const segmentFlags = new Uint16Array(16);
  for (const [segment, value] of Object.entries(flags)) segmentFlags[Number(segment)] = value;
  return createVehicleTrack({
    rideId: 0,
    points: Int32Array.from(points),
    segmentFlags,
    loop: true,
  });
}

const registry = (...tracks: ReturnType<typeof squareLoop>[]) => new VehicleTrackRegistry(tracks);

describe('block sections', () => {
  const sections = () => squareLoop({ 0: STATION, 1: STATION, 6: BLOCK, 11: BLOCK });

  it('limits a loop to one train fewer than it has block boundaries', () => {
    expect(blockLimit(sections())).toBe(2);
    expect(blockLimit(squareLoop({ 0: STATION }))).toBe(1);
    expect(blockLimit(squareLoop({}))).toBe(1);
  });

  it('holds a train at the end of its zone while the next zone is occupied, then releases it', () => {
    const w = world();
    const track = sections();
    const tracks = registry(track);
    // A train stands on the platform; the second approaches the block ahead of it.
    const platform = spawnTrain(w, { rideId: 0, state: VehicleState.Waiting, carCount: 2 });
    w.vehicles.cols.trackPos[platform] = track.stationEndQ8;
    const approaching = spawnTrain(w, {
      rideId: 0,
      state: VehicleState.Running,
      speed: 2000,
      carCount: 2,
      mass: 9000,
    });
    w.vehicles.cols.trackPos[approaching] = 9 * 256 * Q8;
    const blockEnd = track.boundariesQ8[2];

    for (let i = 0; i < 400; i++) {
      stepVehicles(w, tracks);
      expect(w.vehicles.cols.trackPos[approaching]).toBeLessThanOrEqual(blockEnd);
    }
    expect(w.vehicles.cols.trackPos[approaching]).toBe(blockEnd);
    expect(w.vehicles.cols.speed[approaching]).toBe(0);
    expect(w.vehicles.cols.state[approaching]).toBe(VehicleState.Running);

    w.vehicles.cols.state[platform] = VehicleState.Crashed;
    for (let i = 0; i < 40; i++) stepVehicles(w, tracks);
    expect(w.vehicles.cols.trackPos[approaching]).toBeGreaterThan(blockEnd);
    expect(w.vehicles.cols.speed[approaching]).toBeGreaterThan(0);
  });

  it('counts the rear cars of a long train as still occupying the zone behind', () => {
    const w = world();
    const track = sections();
    const tracks = registry(track);
    const leader = spawnTrain(w, {
      rideId: 0,
      state: VehicleState.Running,
      speed: 300,
      carCount: 5,
    });
    // Head just past the station end: the rear cars are still in the station zone.
    w.vehicles.cols.trackPos[leader] = track.stationEndQ8 + 20 * Q8;
    const follower = spawnTrain(w, {
      rideId: 0,
      state: VehicleState.Running,
      speed: 0,
      carCount: 1,
    });
    w.vehicles.cols.trackPos[follower] = track.boundariesQ8[2];
    stepVehicles(w, tracks);
    // The follower sits at the end of the zone before the station zone; the leader's tail blocks it.
    expect(w.vehicles.cols.trackPos[leader] - 5 * CAR_LENGTH_Q8).toBeLessThan(track.stationEndQ8);
    expect(w.vehicles.cols.speed[follower]).toBe(0);
  });
});

describe('station arrival', () => {
  it('brakes a running train to a stop at the platform end and starts unloading', () => {
    const w = world();
    const track = squareLoop({ 0: STATION, 1: STATION });
    const tracks = registry(track);
    const train = spawnTrain(w, {
      rideId: 0,
      state: VehicleState.Running,
      speed: 2500,
      carCount: 3,
    });
    w.vehicles.cols.trackPos[train] = 14 * 256 * Q8;
    w.vehicles.cols.lastSegment[train] = 14;
    const states: number[] = [];
    for (let i = 0; i < 600 && w.vehicles.cols.state[train] !== VehicleState.Unloading; i++) {
      stepVehicles(w, tracks);
      states.push(w.vehicles.cols.state[train]);
      if (w.vehicles.cols.state[train] === VehicleState.Arriving) {
        expect(w.vehicles.cols.trackPos[train]).toBeLessThanOrEqual(track.stationEndQ8);
      }
    }
    const final = getTrainState(w, train);
    expect(final.state).toBe(VehicleState.Unloading);
    expect(final.trackPos).toBe(track.stationEndQ8);
    expect(final.speed).toBe(0);
    expect(states).toContain(VehicleState.Arriving);
  });

  it('is deterministic', () => {
    const run = () => {
      const w = world();
      const track = squareLoop({ 0: STATION, 1: STATION });
      const tracks = registry(track);
      const train = spawnTrain(w, { rideId: 0, state: VehicleState.Running, speed: 1800 });
      w.vehicles.cols.trackPos[train] = 13 * 256 * Q8;
      w.vehicles.cols.lastSegment[train] = 13;
      const trace: number[] = [];
      for (let i = 0; i < 200; i++) {
        stepVehicles(w, tracks);
        trace.push(w.vehicles.cols.trackPos[train], w.vehicles.cols.speed[train]);
      }
      return trace;
    };
    expect(run()).toEqual(run());
  });
});

describe('per-car forces', () => {
  const hill = (flags: number[] = [0, 0]) =>
    createVehicleTrack({
      rideId: 0,
      points: Int32Array.from([0, 0, 0, 256, 0, 0, 512, 0, -128]),
      segmentFlags: Uint16Array.from(flags),
    });

  const speedAfter = (cars: number, positionUnits: number, flags?: number[]) => {
    const w = world();
    const tracks = registry(hill(flags));
    const train = spawnTrain(w, {
      rideId: 0,
      state: VehicleState.Running,
      carCount: cars,
      mass: 9000,
    });
    w.vehicles.cols.trackPos[train] = positionUnits * Q8;
    stepVehicles(w, tracks);
    return w.vehicles.cols.speed[train];
  };

  it('pulls a long train down a slope only with the cars that are on it', () => {
    const single = speedAfter(1, 300);
    const crossing = speedAfter(4, 300);
    const wholly = speedAfter(4, 500);
    expect(single).toBeGreaterThan(0);
    expect(crossing).toBeLessThan(single);
    expect(wholly).toBeGreaterThan(crossing);
  });

  it('keeps the chain lift driving while any car is still on it', () => {
    const lifted = [VehicleSegmentFlag.ChainLift, 0];
    expect(speedAfter(1, 280, lifted)).toBeLessThan(1280);
    expect(speedAfter(4, 280, lifted)).toBeGreaterThanOrEqual(1280);
  });
});

describe('rolling friction', () => {
  it('lets heavier trains keep more speed without a minimum-friction floor', () => {
    const coast = (mass: number) => {
      const w = world();
      const tracks = registry(
        createVehicleTrack({
          rideId: 0,
          points: Int32Array.from([0, 0, 0, 100000, 0, 0]),
          segmentFlags: new Uint16Array(1),
        }),
      );
      const train = spawnTrain(w, { rideId: 0, state: VehicleState.Running, speed: 2000, mass });
      for (let i = 0; i < 400; i++) stepVehicles(w, tracks);
      return w.vehicles.cols.speed[train];
    };
    expect(coast(9000)).toBeGreaterThan(coast(5000));
    expect(coast(5000)).toBeGreaterThan(coast(2500));
  });

  it('counts riders as extra mass', () => {
    const coast = (passengers: number) => {
      const w = world();
      const tracks = registry(
        createVehicleTrack({
          rideId: 0,
          points: Int32Array.from([0, 0, 0, 100000, 0, 0]),
          segmentFlags: new Uint16Array(1),
        }),
      );
      const train = spawnTrain(w, {
        rideId: 0,
        state: VehicleState.Running,
        speed: 2000,
        mass: 1500,
        passengers,
      });
      for (let i = 0; i < 400; i++) stepVehicles(w, tracks);
      return w.vehicles.cols.speed[train];
    };
    expect(coast(16)).toBeGreaterThan(coast(0));
  });
});
