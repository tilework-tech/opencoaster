import { describe, expect, it } from 'vitest';
import { createSnapshot, RideInfo } from '../worker/snapshot';
import type { Snapshot } from '../worker/snapshot';
import { Surface } from '../sim/map/tile-map';
import { RideType } from '../sim/rides/ride-types';
import { Z_STEP } from '../sim/core/constants';
import { ridePlacementValid, ridePlacementLevel } from './placement-art';

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

    expect(ridePlacementValid(RideType.MerryGoRound, 3, 3, 0, map, snapshot)).toBe(true);
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
    expect(ridePlacementValid(RideType.MerryGoRound, 3, 3, 0, map, snapshot)).toBe(false);
    snapshot.park.cash = 1_000_000;

    snapshot.buildable[3 * 8 + 3] = 0;
    expect(ridePlacementValid(RideType.MerryGoRound, 3, 3, 0, map, snapshot)).toBe(false);
    snapshot.buildable[3 * 8 + 3] = 1;

    map.surface[3 * 8 + 3] = Surface.Path;
    expect(ridePlacementValid(RideType.MerryGoRound, 3, 3, 0, map, snapshot)).toBe(false);
    map.surface[3 * 8 + 3] = Surface.Grass;

    snapshot.rides.count = 1;
    snapshot.rideInfo[RideInfo.Type] = RideType.MerryGoRound;
    snapshot.rideInfo[RideInfo.RideX] = 3;
    snapshot.rideInfo[RideInfo.RideY] = 3;
    expect(ridePlacementValid(RideType.MerryGoRound, 3, 3, 0, map, snapshot)).toBe(false);
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

    expect(ridePlacementValid(RideType.MerryGoRound, 8, 7, 0, map, snapshot)).toBe(false);

    snapshot.tracks.count = 1;
    const offset = 0;
    snapshot.tracks.data[offset] = 3 * 256 + 128;
    snapshot.tracks.data[offset + 1] = 3 * 256 + 128;
    snapshot.tracks.data[offset + 2] = 0;
    snapshot.tracks.data[offset + 3] = (0 << 16) | (0 << 8) | 0;
    expect(ridePlacementValid(RideType.MerryGoRound, 3, 3, 0, map, snapshot)).toBe(false);
  });

  function openMap(): {
    width: number;
    height: number;
    heights: Uint8Array;
    surface: Uint8Array;
    slope: Uint8Array;
    sceneryElements: Int32Array;
    sceneryCount: number;
  } {
    return {
      width: 8,
      height: 8,
      heights: new Uint8Array(64),
      surface: new Uint8Array(64),
      slope: new Uint8Array(64),
      sceneryElements: new Int32Array(0),
      sceneryCount: 0,
    };
  }

  it('checks every footprint tile, so a path on an outer tile still blocks', () => {
    const snapshot = placementSnapshot(8, 8);
    const map = openMap();
    map.surface[4 * 8 + 4] = Surface.Path;
    expect(ridePlacementValid(RideType.MerryGoRound, 3, 3, 0, map, snapshot)).toBe(false);
    expect(ridePlacementValid(RideType.MerryGoRound, 5, 5, 0, map, snapshot)).toBe(false);
    expect(ridePlacementValid(RideType.MerryGoRound, 6, 6, 0, map, snapshot)).toBe(true);
  });

  it('follows the orientation of a long ride at the map edge', () => {
    const snapshot = placementSnapshot(8, 8);
    const map = openMap();
    expect(ridePlacementValid(RideType.SwingingShip, 6, 3, 0, map, snapshot)).toBe(true);
    expect(ridePlacementValid(RideType.SwingingShip, 6, 3, 1, map, snapshot)).toBe(false);
    expect(ridePlacementValid(RideType.SwingingShip, 3, 3, 1, map, snapshot)).toBe(true);
  });

  it('rejects scenery in the footprint and ground too uneven for the supports', () => {
    const snapshot = placementSnapshot(8, 8);
    const map = openMap();
    map.sceneryCount = 1;
    map.sceneryElements = Int32Array.of(4, 2, 0, 0, 0);
    expect(ridePlacementValid(RideType.MerryGoRound, 3, 3, 0, map, snapshot)).toBe(false);
    map.sceneryCount = 0;
    map.heights[2 * 8 + 4] = 9;
    expect(ridePlacementValid(RideType.MerryGoRound, 3, 3, 0, map, snapshot)).toBe(false);
  });

  it('puts the floor at the highest ground under the footprint', () => {
    const map = openMap();
    map.heights.fill(4);
    map.heights[4 * 8 + 4] = 6;
    map.slope[3 * 8 + 3] = 2;
    expect(ridePlacementLevel(RideType.MerryGoRound, 3, 3, 0, map)).toBe(6);
    expect(ridePlacementLevel(RideType.MerryGoRound, 2, 2, 0, map)).toBe(5);
    expect(ridePlacementLevel(RideType.MerryGoRound, 6, 6, 0, map)).toBe(4);
  });

  it('uses the selected tower height when checking vertical obstruction clearance', () => {
    const snapshot = placementSnapshot(8, 8);
    snapshot.occupancies.push({
      tileX: 3,
      tileY: 3,
      base: 14 * Z_STEP,
      clearance: 15 * Z_STEP,
      kind: 'track',
      name: 'Elevated track',
    });
    const map = openMap();

    expect(ridePlacementValid(RideType.ObservationTower, 3, 3, 0, map, snapshot, 11)).toBe(true);
    expect(ridePlacementValid(RideType.ObservationTower, 3, 3, 0, map, snapshot, 20)).toBe(false);
  });
});
