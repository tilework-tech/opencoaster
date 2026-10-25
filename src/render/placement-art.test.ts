import { describe, expect, it } from 'vitest';
import { createSnapshot, RideInfo } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import { Surface } from '../sim/map/tile-map';
import { RideType } from '../sim/rides/ride-types';
import { ridePlacementValid } from './placement-art';

function placementSnapshot(width: number, height: number): Snapshot {
  const snapshot = createSnapshot({
    guests: 0,
    staff: 0,
    vehicles: 0,
    litter: 0,
    mapTiles: width * height,
  });
  snapshot.park.cash = 1_000_000;
  snapshot.buildable.fill(1);
  return snapshot;
}

describe('ride placement preview validity', () => {
  it('accepts a buildable, empty footprint that the park can afford', () => {
    const snapshot = placementSnapshot(8, 8);
    const map = {
      width: 8,
      height: 8,
      heights: new Uint8Array(64),
      surface: new Uint8Array(64),
      slope: new Uint8Array(64),
    };

    expect(ridePlacementValid(RideType.MerryGoRound, 3, 3, map, snapshot)).toBe(true);
  });

  it('rejects unaffordable, unowned, non-ground and overlapping footprints', () => {
    const snapshot = placementSnapshot(8, 8);
    const map = {
      width: 8,
      height: 8,
      heights: new Uint8Array(64),
      surface: new Uint8Array(64),
      slope: new Uint8Array(64),
    };

    snapshot.park.cash = 0;
    expect(ridePlacementValid(RideType.MerryGoRound, 3, 3, map, snapshot)).toBe(false);
    snapshot.park.cash = 1_000_000;

    snapshot.buildable[3 * 8 + 3] = 0;
    expect(ridePlacementValid(RideType.MerryGoRound, 3, 3, map, snapshot)).toBe(false);
    snapshot.buildable[3 * 8 + 3] = 1;

    map.surface[3 * 8 + 3] = Surface.Path;
    expect(ridePlacementValid(RideType.MerryGoRound, 3, 3, map, snapshot)).toBe(false);
    map.surface[3 * 8 + 3] = Surface.Grass;

    snapshot.rides.count = 1;
    snapshot.rideInfo[RideInfo.Type] = RideType.MerryGoRound;
    snapshot.rideInfo[RideInfo.RideX] = 3;
    snapshot.rideInfo[RideInfo.RideY] = 3;
    expect(ridePlacementValid(RideType.MerryGoRound, 3, 3, map, snapshot)).toBe(false);
  });

  it('rejects a footprint that crosses the map edge or existing track', () => {
    const snapshot = placementSnapshot(8, 8);
    const map = {
      width: 8,
      height: 8,
      heights: new Uint8Array(64),
      surface: new Uint8Array(64),
      slope: new Uint8Array(64),
    };

    expect(ridePlacementValid(RideType.MerryGoRound, 8, 7, map, snapshot)).toBe(false);

    snapshot.tracks.count = 1;
    const offset = 0;
    snapshot.tracks.data[offset] = 3 * 256 + 128;
    snapshot.tracks.data[offset + 1] = 3 * 256 + 128;
    snapshot.tracks.data[offset + 2] = 0;
    snapshot.tracks.data[offset + 3] = (0 << 16) | (0 << 8) | 0;
    expect(ridePlacementValid(RideType.MerryGoRound, 3, 3, map, snapshot)).toBe(false);
  });
});
