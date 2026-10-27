import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { OWNED } from '../map/tile-map';
import { createRide } from '../rides/ride-operations';
import { RideType } from '../rides/ride-types';
import { PieceId } from './catalog';
import { placeTrack } from './construction';
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
      z: 4,
      dir: 0,
      mode: PieceMode.Normal,
    });

    expect(result).toBe(TrackResult.Blocked);
    expect(world.track.lastBlockerName).toBe('Merry-Go-Round 1 at (13, 13)');
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
      z: 16,
      dir: 0,
      mode: PieceMode.Normal,
    });

    expect(result).toBe(TrackResult.Ok);
  });

  it('explains a track-over-track collision with its tile and required vertical clearance', () => {
    const world = new World({ seed: 4, width: 32, height: 32 });
    world.map.fillFlat(2);
    world.map.ownership.fill(OWNED);
    world.economy.cash = 100_000_000;
    const rides = Array.from({ length: 14 }, (_, index) =>
      createRide(world, RideType.SteelLoopingCoaster, 2 + index, 24),
    );
    const elevated = rides[11]!;
    const groundLevel = rides[13]!;
    placeTrack(world, {
      rideId: elevated,
      pieceType: PieceId.Flat,
      x: 12,
      y: 12,
      z: 6,
      dir: 0,
      mode: PieceMode.Normal,
    });

    expect(
      validatePlaceCommand(world, {
        rideId: groundLevel,
        pieceType: PieceId.Flat,
        x: 12,
        y: 12,
        z: 4,
        dir: 0 as const,
        mode: PieceMode.Normal,
      }),
    ).toBe(TrackResult.Blocked);
    expect(world.track.lastBlockerName).toBe(
      'Steel Looping Coaster 12 track above at (12, 12); needs 1 more level',
    );
  });

  it('describes an equal-height track collision as being at this height', () => {
    const world = new World({ seed: 5, width: 32, height: 32 });
    world.map.fillFlat(2);
    world.map.ownership.fill(OWNED);
    world.economy.cash = 100_000_000;
    const rides = Array.from({ length: 14 }, (_, index) =>
      createRide(world, RideType.SteelLoopingCoaster, 2 + index, 24),
    );
    const first = rides[11]!;
    const second = rides[13]!;
    const piece = {
      pieceType: PieceId.Flat,
      x: 12,
      y: 12,
      z: 4,
      dir: 0 as const,
      mode: PieceMode.Normal,
    };
    expect(placeTrack(world, { rideId: first, ...piece })).toBe(TrackResult.Ok);

    expect(validatePlaceCommand(world, { rideId: second, ...piece })).toBe(TrackResult.Blocked);
    expect(world.track.lastBlockerName).toBe(
      'Steel Looping Coaster 12 track at this height at (12, 12); needs 2 more levels',
    );
  });

  it('allows a Steel Looping Coaster flat piece underneath elevated Steel Looping track', () => {
    const world = new World({ seed: 3, width: 32, height: 32 });
    world.map.fillFlat(2);
    world.map.ownership.fill(OWNED);
    world.economy.cash = 100_000_000;
    const rides = Array.from({ length: 14 }, (_, index) =>
      createRide(world, RideType.SteelLoopingCoaster, 2 + index, 24),
    );
    const elevated = rides[11]!;
    const groundLevel = rides[13]!;

    expect(
      placeTrack(world, {
        rideId: elevated,
        pieceType: PieceId.Flat,
        x: 12,
        y: 12,
        z: 8,
        dir: 0 as const,
        mode: PieceMode.Normal,
      }),
    ).toBe(TrackResult.Ok);

    const candidate = {
      rideId: groundLevel,
      pieceType: PieceId.Flat,
      x: 12,
      y: 12,
      z: 4,
      dir: 0 as const,
      mode: PieceMode.Normal,
    };
    expect(validatePlaceCommand(world, candidate)).toBe(TrackResult.Ok);
    expect(placeTrack(world, candidate)).toBe(TrackResult.Ok);
  });
});
