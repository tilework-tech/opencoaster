import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { OWNED } from './tile-map';
import { createRide } from '../rides/ride-operations';
import { RideType } from '../rides/ride-types';
import { RideResult } from '../rides/ride-results';
import { validateRidePlacement } from '../rides/ride-footprint';
import { occupancyConflict, worldOccupancies } from './occupancy';
import type { OccupancyKind, OccupancyVolume } from './occupancy';

const KINDS: OccupancyKind[] = [
  'track',
  'station',
  'flatRide',
  'facility',
  'rideEntrance',
  'rideExit',
  'path',
  'queue',
  'scenery',
  'wall',
  'parkEntrance',
];

function volume(kind: OccupancyKind, base = 0, clearance = 64): OccupancyVolume {
  return { tileX: 5, tileY: 5, base, clearance, kind, name: kind };
}

describe('shared occupancy intervals', () => {
  it.each(KINDS.flatMap((a, i) => KINDS.slice(i).map((b) => [a, b] as const)))(
    'rejects overlapping %s and %s volumes',
    (a, b) => {
      expect(occupancyConflict(volume(a), volume(b))).toBe(true);
    },
  );

  it.each(KINDS.flatMap((a, i) => KINDS.slice(i).map((b) => [a, b] as const)))(
    'allows %s and %s when their height intervals only touch',
    (a, b) => {
      expect(occupancyConflict(volume(a, 64, 128), volume(b, 0, 64))).toBe(false);
    },
  );

  it('does not block occupancy on a different tile or a disjoint wall edge', () => {
    expect(occupancyConflict(volume('track'), { ...volume('flatRide'), tileX: 6 })).toBe(false);
    expect(
      occupancyConflict(
        { ...volume('wall'), edgeMask: 1 },
        { ...volume('wall'), edgeMask: 2 },
      ),
    ).toBe(false);
  });
});

describe('multi-tile ride occupancy', () => {
  it.each([0, 1, 2, 3])('blocks a second ride on an off-anchor footprint tile at rotation %i', (dir) => {
    const world = new World({ seed: 17, width: 32, height: 32 });
    world.map.fillFlat(2);
    world.map.ownership.fill(OWNED);
    createRide(world, RideType.SwingingShip, 12, 12, dir);
    const rideTiles = worldOccupancies(world).filter((item) => item.name === 'Swinging Ship 1');
    expect(rideTiles).toHaveLength(5);
    const offAnchor = rideTiles.find((item) => item.tileX !== 12 || item.tileY !== 12)!;
    expect(validateRidePlacement(world, RideType.MerryGoRound, offAnchor.tileX, offAnchor.tileY, 0)).toBe(
      RideResult.Blocked,
    );
  });
});
