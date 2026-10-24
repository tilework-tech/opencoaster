import { describe, expect, it } from 'vitest';
import { findRideIdAtTile } from './object-picking';
import { RideType } from '../sim/rides/ride-types';
import { RideInfo, SNAPSHOT_STRIDE, createSnapshot } from '../worker/snapshot';

function snapshotWithRide(id = 17) {
  const snapshot = createSnapshot({ guests: 0, staff: 0, vehicles: 0, litter: 0 });
  snapshot.rides.count = 1;
  snapshot.rideInfo[RideInfo.Id] = id;
  snapshot.rideInfo[RideInfo.Type] = RideType.MerryGoRound;
  snapshot.rideInfo[RideInfo.RideX] = 4;
  snapshot.rideInfo[RideInfo.RideY] = 5;
  return snapshot;
}

describe('ride picking', () => {
  it('finds a ride on its footprint tile', () => {
    const snapshot = snapshotWithRide();

    expect(findRideIdAtTile(snapshot, 4, 5)).toBe(17);
  });

  it('finds a track ride from one of its track tiles', () => {
    const snapshot = snapshotWithRide();
    snapshot.tracks.count = 1;
    snapshot.tracks.data[SNAPSHOT_STRIDE * 0] = 8 * 256 + 128;
    snapshot.tracks.data[SNAPSHOT_STRIDE * 0 + 1] = 9 * 256 + 128;
    snapshot.tracks.data[SNAPSHOT_STRIDE * 0 + 3] = 17 << 16;

    expect(findRideIdAtTile(snapshot, 8, 9)).toBe(17);
  });

  it('finds the first track ride whose stable ID is zero', () => {
    const snapshot = snapshotWithRide(0);
    snapshot.tracks.count = 1;
    snapshot.tracks.data[SNAPSHOT_STRIDE * 0] = 8 * 256 + 128;
    snapshot.tracks.data[SNAPSHOT_STRIDE * 0 + 1] = 9 * 256 + 128;
    snapshot.tracks.data[SNAPSHOT_STRIDE * 0 + 3] = 0;

    expect(findRideIdAtTile(snapshot, 8, 9)).toBe(0);
  });

  it('returns null when the selected tile is outside every ride', () => {
    expect(findRideIdAtTile(snapshotWithRide(), 0, 0)).toBeNull();
  });
});
