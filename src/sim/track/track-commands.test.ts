import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { OWNED, Surface } from '../map/tile-map';
import { applyRideCommand } from '../rides/ride-commands';
import { createRide } from '../rides/ride-operations';
import { RideResult } from '../rides/ride-results';
import { RideType } from '../rides/ride-types';
import { PieceId } from './catalog';
import { pieceExit } from './construction';
import { applyTrackCommand, validatePlaceCommand } from './track-commands';
import { PieceMode, TrackResult } from './track-types';

function ownedWorld(): World {
  const world = new World({ seed: 1, width: 32, height: 32 });
  world.map.heights.fill(2);
  world.map.ownership.fill(OWNED);
  return world;
}

describe('track command validation', () => {
  it.each([RideType.LogFlume, RideType.RiverRapids])(
    'rejects a coaster station and track on open water but permits %s',
    (waterRideType) => {
    const world = ownedWorld();
    for (const tile of [world.map.index(11, 10), world.map.index(21, 20)]) {
      world.map.surface[tile] = Surface.Water;
      world.map.waterLevel[tile] = 3;
    }
    const coasterId = createRide(world, RideType.SteelLoopingCoaster, 10, 10);
    const waterRideId = createRide(world, waterRideType, 20, 20);
    const station = {
      pieceType: PieceId.Station,
      x: 10,
      y: 10,
      z: 10,
      dir: 0 as const,
      mode: PieceMode.Normal,
    };
    expect(applyTrackCommand(world, { type: 'placeTrack', rideId: coasterId, ...station })).toBe(
      TrackResult.Ok,
    );
    expect(
      validatePlaceCommand(world, {
        ...station,
        rideId: coasterId,
        pieceType: PieceId.Station,
        x: 11,
        y: 10,
      }),
    ).toBe(TrackResult.OverWater);
    expect(
      applyTrackCommand(world, {
        type: 'placeTrack',
        rideId: coasterId,
        ...station,
        x: 11,
        y: 10,
      }),
    ).toBe(TrackResult.OverWater);
    expect(
      applyTrackCommand(world, {
        type: 'placeTrack',
        rideId: coasterId,
        pieceType: PieceId.Flat,
        x: 11,
        y: 10,
        z: 10,
        dir: 0,
        mode: PieceMode.Normal,
      }),
    ).toBe(TrackResult.OverWater);

    expect(
      applyTrackCommand(world, {
        type: 'placeTrack',
        rideId: waterRideId,
        ...station,
        x: 20,
        y: 20,
      }),
    ).toBe(TrackResult.Ok);
    expect(
      applyTrackCommand(world, {
        type: 'placeTrack',
        rideId: waterRideId,
        pieceType: PieceId.Flat,
        x: 21,
        y: 20,
        z: 10,
        dir: 0,
        mode: PieceMode.Normal,
      }),
    ).toBe(TrackResult.Ok);
    },
  );

  it.each(
    [RideType.SteelLoopingCoaster, RideType.LogFlume, RideType.RiverRapids].flatMap((rideType) =>
      ([0, 1, 2, 3] as const).map((dir) => [rideType, dir] as const),
    ),
  )(
    'extends station access for ride %s at both ends (orientation %i)',
    (rideType, dir) => {
      const world = ownedWorld();
      const rideId = createRide(world, rideType, 10, 10);
      const first = {
        pieceType: PieceId.Station,
        x: 10,
        y: 10,
        z: 10,
        dir,
        mode: PieceMode.Normal,
      };
      expect(applyTrackCommand(world, { type: 'placeTrack', rideId, ...first })).toBe(
        TrackResult.Ok,
      );
      let station = first;
      for (let segment = 1; segment < 3; segment++) {
        const next = pieceExit(PieceId.Station, station.x, station.y, station.z, station.dir);
        station = { ...station, x: next.x, y: next.y, z: next.z };
        expect(applyTrackCommand(world, { type: 'placeTrack', rideId, ...station })).toBe(
          TrackResult.Ok,
        );
      }

      const adjacentTiles = (x: number, y: number) =>
        [
          [x + 1, y],
          [x, y + 1],
          [x - 1, y],
          [x, y - 1],
        ] as const;
      const firstAccess = adjacentTiles(first.x, first.y).find(
        ([x, y]) =>
          applyRideCommand(world, { type: 'placeRideEntrance', rideId, x, y }) === RideResult.Ok,
      );
      expect(firstAccess).toBeDefined();
      const lastAccess = adjacentTiles(station.x, station.y).find(([x, y]) => {
        if (firstAccess?.[0] === x && firstAccess[1] === y) return false;
        return applyRideCommand(world, { type: 'placeRideExit', rideId, x, y }) === RideResult.Ok;
      });
      expect(lastAccess).toBeDefined();
    },
  );
});
