import { describe, expect, it } from 'vitest';
import { placePath } from '../map/paths';
import { Surface } from '../map/tile-map';
import { createRideAtCorner, flatWorld } from '../integration/fixtures';
import { createRide } from './ride-operations';
import { applyRideCommand } from './ride-commands';
import type { RideCommand } from './ride-commands';
import { RideType } from './ride-types';
import { RideResult } from './ride-results';
import { RIDE_CATALOG } from './ride-types';
import { rideSystem } from './ride-system';
import { RidePhase, RideState } from './ride-store';
import { LedgerCategory } from '../economy/ledger';
import { GuestState } from '../guests/guest-store';
import { trackSystem } from '../track/track-system';
import { refreshRideQueueConnections } from './ride-commands';
import { charge } from '../economy/api';
import { applyTrackCommand } from '../track/track-commands';
import { PIECES, PieceId } from '../track/catalog';
import { PieceMode, TrackResult } from '../track/track-types';
import { TILE_UNITS } from '../core/constants';
import { removePath } from '../map/paths';

describe('ride commands', () => {
  it('opens a flat ride when its queue is connected after entrance and exit placement', () => {
    const world = flatWorld(16, 17);
    const rideId = createRideAtCorner(world, RideType.MerryGoRound, [4, 4]);
    const apply = (command: RideCommand) => applyRideCommand(world, command);

    expect(apply({ type: 'placeRideEntrance', rideId, x: 4, y: 5 })).toBe(RideResult.Ok);
    expect(apply({ type: 'placeRideExit', rideId, x: 5, y: 4 })).toBe(RideResult.Ok);
    expect(placePath(world.map, { x: 3, y: 5, queue: true })).toBe(true);
    expect(placePath(world.map, { x: 2, y: 5 })).toBe(true);
    expect(apply({ type: 'setRideStatus', rideId, status: 'open' })).toBe(RideResult.Ok);
  });

  it.each([
    [5, 4],
    [4, 5],
    [3, 4],
    [4, 3],
  ])('places Ferris Wheel access on each side at (%i, %i)', (x, y) => {
    const world = flatWorld(16, 17);
    const rideId = createRide(world, RideType.FerrisWheel, 4, 4);
    expect(applyRideCommand(world, { type: 'placeRideEntrance', rideId, x, y })).toBe(
      RideResult.Ok,
    );
    const exit = [
      [5, 4],
      [4, 5],
      [3, 4],
      [4, 3],
    ].find(([exitX, exitY]) => exitX !== x || exitY !== y)!;
    expect(applyRideCommand(world, { type: 'placeRideExit', rideId, x: exit[0], y: exit[1] })).toBe(
      RideResult.Ok,
    );
  });

  it('dry-runs a flat ride without serving guests and returns it to closed', () => {
    const world = flatWorld(16, 17);
    const rideId = createRide(world, RideType.FerrisWheel, 4, 4);
    const slot = world.rides.idToSlot[rideId];
    expect(applyRideCommand(world, { type: 'setRideStatus', rideId, status: 'test' })).toBe(
      RideResult.Ok,
    );
    expect(world.rides.cols.state[slot]).toBe(RideState.Testing);

    for (let tick = 0; tick < 2_000 && world.rides.cols.state[slot] === RideState.Testing; tick++)
      rideSystem.update(world);

    expect(world.rides.cols.state[slot]).toBe(RideState.Closed);
    expect(world.rides.cols.tested[slot]).toBe(1);
    expect(world.rides.cols.guestsServed[slot]).toBe(0);
    expect(world.rides.cols.boarded[slot]).toBe(0);
    expect(world.rides.cols.phase[slot]).toBe(RidePhase.Closed);
  });

  it.each([RideType.Toilets, RideType.FoodStall])(
    'opens a shop or toilet directly from an adjacent path (%s)',
    (type) => {
      const world = flatWorld(16, 17);
      const rideId = createRide(world, type, 4, 4);
      expect(placePath(world.map, { x: 4, y: 5 })).toBe(true);
      refreshRideQueueConnections(world);

      expect(applyRideCommand(world, { type: 'setRideStatus', rideId, status: 'open' })).toBe(
        RideResult.Ok,
      );
      expect(world.map.surface[world.map.index(4, 5)]).toBe(Surface.Path);
    },
  );

  it('demolishes an unused ride and refunds its full construction cost once', () => {
    const world = flatWorld(16, 17);
    const definition = RIDE_CATALOG[RideType.MerryGoRound];
    const rideId = createRide(world, RideType.MerryGoRound, 4, 4);
    charge(world, LedgerCategory.RideConstruction, definition.cost);
    const cashAfterConstruction = world.economy.cash;
    const demolition: RideCommand = { type: 'demolishRide', rideId };

    expect(applyRideCommand(world, demolition)).toBe(RideResult.Ok);
    expect(world.economy.cash).toBe(1_000_000);
    expect(world.economy.cash - cashAfterConstruction).toBe(definition.cost);
    expect(world.economy.monthlyTotals[LedgerCategory.RideConstruction]).toBe(0);
    expect(world.rides.isAlive(rideId)).toBe(false);
    trackSystem.update(world);
    expect(applyRideCommand(world, demolition)).toBe(RideResult.NoSuchRide);
    expect(world.economy.cash).toBe(1_000_000);
  });

  it('refunds less after a ride has served guests and clears their destination', () => {
    const world = flatWorld(16, 17);
    const definition = RIDE_CATALOG[RideType.MerryGoRound];
    const rideId = createRide(world, RideType.MerryGoRound, 4, 4);
    const rideSlot = world.rides.idToSlot[rideId];
    world.rides.cols.guestsServed[rideSlot] = 1;
    charge(world, LedgerCategory.RideConstruction, definition.cost);
    const cashAfterConstruction = world.economy.cash;
    const guest = world.guests.spawn();
    world.guests.cols.targetRide[guest] = rideId;
    world.guests.cols.state[guest] = GuestState.Queuing;

    expect(applyRideCommand(world, { type: 'demolishRide', rideId })).toBe(RideResult.Ok);
    expect(world.economy.cash).toBeLessThan(1_000_000);
    expect(world.economy.cash).toBeGreaterThan(cashAfterConstruction);
    expect(world.guests.cols.targetRide[guest]).toBe(-1);
    expect(world.guests.cols.state[guest]).not.toBe(GuestState.Queuing);
  });

  it('moves a rider to the exit when their ride is demolished', () => {
    const world = flatWorld(16, 17);
    const rideId = createRide(world, RideType.MerryGoRound, 4, 4);
    const rideSlot = world.rides.idToSlot[rideId];
    expect(applyRideCommand(world, { type: 'placeRideEntrance', rideId, x: 4, y: 5 })).toBe(
      RideResult.Ok,
    );
    expect(applyRideCommand(world, { type: 'placeRideExit', rideId, x: 5, y: 4 })).toBe(
      RideResult.Ok,
    );
    const guest = world.guests.spawn();
    world.guests.cols.targetRide[guest] = rideId;
    world.guests.cols.state[guest] = GuestState.Riding;
    world.guests.cols.x[guest] = world.rides.cols.rideX[rideSlot] * TILE_UNITS + TILE_UNITS / 2;
    world.guests.cols.y[guest] = world.rides.cols.rideY[rideSlot] * TILE_UNITS + TILE_UNITS / 2;

    expect(applyRideCommand(world, { type: 'demolishRide', rideId })).toBe(RideResult.Ok);

    expect(world.guests.cols.targetRide[guest]).toBe(-1);
    expect(world.guests.cols.state[guest]).toBe(GuestState.Wandering);
    expect(world.guests.cols.x[guest]).toBe(5 * TILE_UNITS + TILE_UNITS / 2);
    expect(world.guests.cols.y[guest]).toBe(4 * TILE_UNITS + TILE_UNITS / 2);
  });

  it('uses the entrance when the ride exit is no longer walkable', () => {
    const world = flatWorld(16, 17);
    const rideId = createRide(world, RideType.MerryGoRound, 4, 4);
    expect(applyRideCommand(world, { type: 'placeRideEntrance', rideId, x: 4, y: 5 })).toBe(
      RideResult.Ok,
    );
    expect(applyRideCommand(world, { type: 'placeRideExit', rideId, x: 5, y: 4 })).toBe(
      RideResult.Ok,
    );
    expect(removePath(world.map, { x: 5, y: 4 })).toBe(true);
    const guest = world.guests.spawn();
    world.guests.cols.targetRide[guest] = rideId;
    world.guests.cols.state[guest] = GuestState.Riding;

    expect(applyRideCommand(world, { type: 'demolishRide', rideId })).toBe(RideResult.Ok);

    expect(world.guests.cols.x[guest]).toBe(4 * TILE_UNITS + TILE_UNITS / 2);
    expect(world.guests.cols.y[guest]).toBe(5 * TILE_UNITS + TILE_UNITS / 2);
  });

  it('clears removed direct access and closes a shop or facility without another path', () => {
    const world = flatWorld(16, 17);
    const rideId = createRide(world, RideType.Toilets, 4, 4);
    const slot = world.rides.idToSlot[rideId];
    expect(placePath(world.map, { x: 4, y: 5 })).toBe(true);
    refreshRideQueueConnections(world);
    expect(applyRideCommand(world, { type: 'setRideStatus', rideId, status: 'open' })).toBe(
      RideResult.Ok,
    );

    expect(removePath(world.map, { x: 4, y: 5 })).toBe(true);
    refreshRideQueueConnections(world);

    expect(world.rides.cols.entrancePlaced[slot]).toBe(0);
    expect(world.rides.cols.state[slot]).toBe(RideState.Closed);
  });

  it('demolishes a coaster, refunds its track and ride cost, and removes its track', () => {
    const world = flatWorld(16, 17);
    const definition = RIDE_CATALOG[RideType.SteelLoopingCoaster];
    const rideId = createRide(world, RideType.SteelLoopingCoaster, 4, 4);
    charge(world, LedgerCategory.RideConstruction, definition.cost);
    expect(
      applyTrackCommand(world, {
        type: 'placeTrack',
        rideId,
        pieceType: PieceId.Station,
        x: 4,
        y: 4,
        z: 10,
        dir: 0,
        mode: PieceMode.Normal,
      }),
    ).toBe(TrackResult.Ok);
    const cashAfterConstruction = world.economy.cash;

    expect(applyRideCommand(world, { type: 'demolishRide', rideId })).toBe(RideResult.Ok);
    expect(world.economy.cash).toBe(
      cashAfterConstruction + definition.cost + PIECES[PieceId.Station].cost,
    );
    trackSystem.update(world);
    expect(world.track.pieces.count).toBe(0);
  });
});
