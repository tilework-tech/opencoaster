import { describe, expect, it } from 'vitest';
import {
  findRideIdAtTile,
  pickTopmostObject,
  pickTopmostSprite,
  pickTrackPiece,
} from './object-picking';
import type { ObjectPickTarget } from './object-picking';
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

describe('sprite picking', () => {
  it('returns the topmost opaque sprite under the pointer and falls through transparent pixels', () => {
    const bottom = {
      id: 'tree',
      x: 10,
      y: 10,
      width: 2,
      height: 2,
      alphaWidth: 2,
      alphaHeight: 2,
      alpha: Uint8Array.of(255, 0, 0, 255),
    };
    const top = {
      id: 'guest',
      x: 10,
      y: 10,
      width: 2,
      height: 2,
      alphaWidth: 2,
      alphaHeight: 2,
      alpha: Uint8Array.of(0, 255, 0, 0),
    };

    expect(pickTopmostSprite([bottom, top], 10.5, 10.5)).toBe('tree');
    expect(pickTopmostSprite([bottom, top], 11.5, 10.5)).toBe('guest');
    expect(pickTopmostSprite([bottom, top], 12, 10.5)).toBeNull();
  });

  it('returns the topmost object target while respecting transparent sprite pixels', () => {
    const scenery = {
      id: 'scenery:1',
      kind: 'scenery' as const,
      name: 'Oak tree',
      tileX: 1,
      tileY: 2,
      sortDepth: 4,
      x: 10,
      y: 10,
      width: 2,
      height: 2,
      alphaWidth: 2,
      alphaHeight: 2,
      alpha: Uint8Array.of(255, 0, 0, 255),
    };
    const person = {
      ...scenery,
      id: 'guest:8',
      kind: 'guest' as const,
      name: 'Guest 8',
      alpha: Uint8Array.of(0, 255, 0, 0),
    };

    expect(pickTopmostObject([scenery, person], 10.5, 10.5)).toBe(scenery);
    expect(pickTopmostObject([scenery, person], 11.5, 10.5)).toBe(person);
    expect(pickTopmostObject([scenery, person], 12, 10.5)).toBeNull();
  });
});

describe('track piece picking', () => {
  const sprite = (over: Partial<ObjectPickTarget>): ObjectPickTarget => ({
    id: 'ride:3',
    kind: 'ride',
    name: 'Wooden coaster',
    tileX: 0,
    tileY: 0,
    sortDepth: 0,
    x: 10,
    y: 10,
    width: 2,
    height: 2,
    alphaWidth: 2,
    alphaHeight: 2,
    alpha: Uint8Array.of(255, 255, 255, 255),
    rideId: 3,
    ...over,
  });

  it('returns the rail piece drawn on top, ignoring scenery and guests in front of it', () => {
    const lower = sprite({ coasterPart: 'track', pieceId: 4, sortDepth: 1 });
    const upper = sprite({
      coasterPart: 'track',
      pieceId: 9,
      sortDepth: 2,
      alpha: Uint8Array.of(0, 255, 0, 0),
    });
    const tree = sprite({ id: 'scenery:1', kind: 'scenery', rideId: undefined, sortDepth: 5 });

    expect(
      pickTrackPiece(
        [upper, lower, tree].sort((a, b) => a.sortDepth - b.sortDepth),
        11.5,
        10.5,
      ),
    ).toEqual({ rideId: 3, pieceId: 9 });
    expect(pickTrackPiece([lower, upper, tree], 10.5, 10.5)).toEqual({ rideId: 3, pieceId: 4 });
    expect(pickTrackPiece([tree], 10.5, 10.5)).toBeNull();
  });

  it('does not turn a click on a train or a support into a track piece', () => {
    const rail = sprite({ coasterPart: 'track', pieceId: 4 });
    const car = sprite({ coasterPart: 'car', sortDepth: 2 });
    const support = sprite({ coasterPart: 'support', pieceId: 4, sortDepth: 2 });

    expect(pickTrackPiece([rail, car], 10.5, 10.5)).toEqual({ rideId: 3, part: 'car' });
    expect(pickTrackPiece([rail, support], 10.5, 10.5)).toEqual({ rideId: 3, part: 'support' });
  });
});
