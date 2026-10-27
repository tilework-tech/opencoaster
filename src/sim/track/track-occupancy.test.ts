import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { OWNED } from '../map/tile-map';
import { createRide } from '../rides/ride-operations';
import { RideType } from '../rides/ride-types';
import { PieceId } from './catalog';
import { validatePlaceCommand } from './track-commands';
import { PieceMode, TrackResult } from './track-types';

describe('track placement against rides', () => {
  it('refuses track through any tile of the Merry-Go-Round footprint', () => {
    const world = new World({ seed: 1, width: 32, height: 32 });
    world.map.fillFlat(2);
    world.map.ownership.fill(OWNED);
    world.economy.cash = 100_000_000;
    createRide(world, RideType.MerryGoRound, 12, 12);
    const coaster = createRide(world, RideType.WoodenCoaster, 20, 20);

    const result = validatePlaceCommand(world, {
      rideId: coaster,
      pieceType: PieceId.Station,
      x: 13,
      y: 13,
      z: 2,
      dir: 0,
      mode: PieceMode.Normal,
    });

    expect(result).toBe(TrackResult.Blocked);
  });

  it('allows an overpass when the track clearance starts above the ride', () => {
    const world = new World({ seed: 2, width: 32, height: 32 });
    world.map.fillFlat(2);
    world.map.ownership.fill(OWNED);
    world.economy.cash = 100_000_000;
    createRide(world, RideType.MerryGoRound, 12, 12);
    const coaster = createRide(world, RideType.WoodenCoaster, 20, 20);

    const result = validatePlaceCommand(world, {
      rideId: coaster,
      pieceType: PieceId.Station,
      x: 13,
      y: 13,
      z: 8,
      dir: 0,
      mode: PieceMode.Normal,
    });

    expect(result).toBe(TrackResult.Ok);
  });
});
