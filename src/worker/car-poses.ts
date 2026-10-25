import type { World } from '../sim/core/world';
import { CAR_LENGTH_Q8 } from '../sim/vehicles/vehicle-system';
import type { VehicleTrack } from '../sim/vehicles/vehicle-system';
import type { SnapshotLayer } from './snapshot';

/** Roll class of a published car. */
export const enum CarBank {
  Level = 0,
  Left = 1,
  Right = 2,
  Inverted = 3,
}

export const CAR_HEADINGS = 8;
/** Pitch classes run from -3 (vertical drop) to +3 (vertical climb); 1 and 2 are 25 and 60 degrees. */
export const CAR_PITCH_MAX = 3;

export interface CarPose {
  rideId: number;
  /** Eighth-turn heading: 0 is +x, increasing toward +y. */
  heading: number;
  pitch: number;
  bank: CarBank;
  /** Number of riders assigned to this car, capped at seven for the packed pose. */
  passengers?: number;
}

/** Word 3 of a car row: ride id in the high half, then bank, pitch and heading bit fields. */
export function encodeCarPose(pose: CarPose): number {
  return (
    (pose.rideId << 16) |
    (pose.bank << 7) |
    ((pose.pitch + CAR_PITCH_MAX) << 3) |
    ((Math.min(7, pose.passengers ?? 0) & 7) << 9) |
    pose.heading
  );
}

export function decodeCarPose(word: number): CarPose {
  return {
    rideId: word >>> 16,
    bank: ((word >> 7) & 3) as CarBank,
    pitch: ((word >> 3) & 15) - CAR_PITCH_MAX,
    passengers: (word >> 9) & 7,
    heading: word & 7,
  };
}

const BANK_SIN_THRESHOLD_Q8 = 64;

function segmentIndex(track: VehicleTrack, positionQ8: number): number {
  const cumulative = track.cumulativeLengthsQ8;
  let low = 0;
  let high = cumulative.length - 2;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (positionQ8 >= cumulative[mid]) low = mid;
    else high = mid - 1;
  }
  return low;
}

function headingOf(track: VehicleTrack, segment: number): number {
  const segments = track.segmentLengths.length;
  for (let step = 0; step < segments; step++) {
    for (const candidate of [segment - step, segment + step]) {
      if (candidate < 0 || candidate >= segments) continue;
      const p = candidate * 3;
      const dx = track.points[p + 3] - track.points[p];
      const dy = track.points[p + 4] - track.points[p + 1];
      if (dx !== 0 || dy !== 0) {
        const turn = Math.atan2(dy, dx) / (Math.PI * 2);
        return ((Math.round(turn * CAR_HEADINGS) % CAR_HEADINGS) + CAR_HEADINGS) % CAR_HEADINGS;
      }
    }
  }
  return 0;
}

function pitchOf(track: VehicleTrack, segment: number): number {
  const p = segment * 3;
  const dx = track.points[p + 3] - track.points[p];
  const dy = track.points[p + 4] - track.points[p + 1];
  const dz = track.points[p + 5] - track.points[p + 2];
  const angle = Math.atan2(Math.abs(dz), Math.hypot(dx, dy));
  const degrees = (angle * 180) / Math.PI;
  const magnitude = degrees < 13 ? 0 : degrees < 45 ? 1 : degrees < 77 ? 2 : 3;
  return dz < 0 ? -magnitude : magnitude;
}

function bankOf(track: VehicleTrack, segment: number): CarBank {
  if (track.invertedSegments[segment] || track.bankCosQ8[segment] < 0) return CarBank.Inverted;
  const sin = track.bankSinQ8[segment];
  if (sin > BANK_SIN_THRESHOLD_Q8) return CarBank.Right;
  if (sin < -BANK_SIN_THRESHOLD_Q8) return CarBank.Left;
  return CarBank.Level;
}

/** Writes one row per car of every train: world x/y/z, then the packed pose word. */
export function writeCarPoses(world: World, out: SnapshotLayer): void {
  const tracks = world.vehicleTracks;
  const cols = world.vehicles.cols;
  const capacity = out.data.length / 4;
  let count = 0;
  for (let slot = 0; tracks && slot < world.vehicles.count; slot++) {
    const track = tracks.get(cols.rideId[slot]);
    if (!track) continue;
    const carCount = Math.max(1, cols.carCount[slot]);
    const passengersPerCar = Math.floor(cols.passengers[slot] / carCount);
    const extraPassengers = cols.passengers[slot] % carCount;
    for (let car = 0; car < carCount; car++) {
      if (count === capacity) break;
      let at = cols.trackPos[slot] - Math.round((car + 0.5) * CAR_LENGTH_Q8);
      if (at < 0) at = track.loop ? at + track.totalLengthQ8 : 0;
      const segment = segmentIndex(track, Math.min(at, track.totalLengthQ8 - 1));
      const p = segment * 3;
      const lengthQ8 = track.segmentLengths[segment] << 8;
      const local = Math.max(0, Math.min(lengthQ8, at - track.cumulativeLengthsQ8[segment]));
      const t = lengthQ8 > 0 ? local / lengthQ8 : 0;
      const o = count * 4;
      for (let axis = 0; axis < 3; axis++)
        out.data[o + axis] = Math.round(
          track.points[p + axis] + (track.points[p + 3 + axis] - track.points[p + axis]) * t,
        );
      out.data[o + 3] = encodeCarPose({
        rideId: cols.rideId[slot],
        heading: headingOf(track, segment),
        pitch: pitchOf(track, segment),
        bank: bankOf(track, segment),
        passengers: Math.min(7, passengersPerCar + Number(car < extraPassengers)),
      });
      count++;
    }
  }
  out.count = count;
}
