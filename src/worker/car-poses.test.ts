import { describe, expect, it } from 'vitest';
import { World } from '../sim/core/world';
import {
  createVehicleTrack,
  VehicleTrackRegistry,
  CAR_LENGTH_Q8,
} from '../sim/vehicles/vehicle-system';
import { VehicleState, spawnTrain } from '../sim/vehicles/vehicle-store';
import { createSnapshot } from './snapshot';
import { decodeCarPose, writeCarPoses, CarBank } from './car-poses';

function line(dx: number, dy: number, dz: number, bankCos = 256) {
  const points: number[] = [];
  for (let i = 0; i <= 8; i++) points.push(i * dx, i * dy, i * dz);
  return createVehicleTrack({
    rideId: 3,
    points: Int32Array.from(points),
    segmentFlags: new Uint16Array(8),
    bankCosQ8: new Int16Array(8).fill(bankCos),
  });
}

function poses(track: ReturnType<typeof line>, cars: number, trackPos: number) {
  const world = new World({ seed: 1, width: 16, height: 16, maxGuests: 4 });
  world.vehicleTracks = new VehicleTrackRegistry([track]);
  spawnTrain(world, { rideId: 3, state: VehicleState.Running, carCount: cars, trackPos: 0 });
  world.vehicles.cols.trackPos[0] = trackPos;
  const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 4, litter: 0 });
  writeCarPoses(world, snapshot.cars);
  return { snapshot, count: snapshot.cars.count };
}

describe('car poses', () => {
  it('publishes one pose per car, spaced back along the track', () => {
    const track = line(256, 0, 0);
    const { snapshot, count } = poses(track, 3, 1200 * 256);
    expect(count).toBe(3);
    const xs = [0, 1, 2].map((i) => snapshot.cars.data[i * 4]);
    expect(xs[0] - xs[1]).toBe(xs[1] - xs[2]);
    expect(xs[0] - xs[1]).toBeCloseTo(CAR_LENGTH_Q8 / 256, -1);
    expect(decodeCarPose(snapshot.cars.data[3])).toMatchObject({ rideId: 3, heading: 0, pitch: 0 });
  });

  it('quantises heading to eight directions', () => {
    const { snapshot } = poses(line(0, 256, 0), 1, 1000 * 256);
    expect(decodeCarPose(snapshot.cars.data[3]).heading).toBe(2);
    const diagonal = poses(line(-256, -256, 0), 1, 1000 * 256);
    expect(decodeCarPose(diagonal.snapshot.cars.data[3]).heading).toBe(5);
  });

  it('classifies pitch, including vertical track whose heading comes from neighbours', () => {
    const up = poses(line(256, 0, 128), 1, 1000 * 256);
    expect(decodeCarPose(up.snapshot.cars.data[3]).pitch).toBe(1);
    const down = poses(line(256, 0, -512), 1, 1000 * 256);
    expect(decodeCarPose(down.snapshot.cars.data[3]).pitch).toBe(-2);
    const vertical = poses(line(0, 0, 256), 1, 1000 * 256);
    expect(decodeCarPose(vertical.snapshot.cars.data[3]).pitch).toBe(3);
  });

  it('flags inverted track', () => {
    const { snapshot } = poses(line(256, 0, 0, -256), 1, 1000 * 256);
    expect(decodeCarPose(snapshot.cars.data[3]).bank).toBe(CarBank.Inverted);
  });
});
