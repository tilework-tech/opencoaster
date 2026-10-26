import { describe, expect, it } from 'vitest';
import { createGuestSystem } from './guest-system';
import { GuestState } from './guest-store';
import { flatWorld, guestAt, layPath, openRide, row } from '../integration/fixtures';
import { RideState } from '../rides/ride-store';
import { createRide } from '../rides/ride-operations';
import { RideType } from '../rides/ride-types';
import { WeatherKind } from '../weather/weather';
import { LedgerCategory } from '../economy/ledger';
import { PathAddition, setPathAddition } from '../map/paths';
import { TILE_UNITS } from '../core/constants';

function chooseRide(weather: WeatherKind, umbrella: boolean) {
  const world = flatWorld(24, 8);
  layPath(world, row(5, 3, 15));
  const guest = guestAt(world, 5, 5);
  world.guests.cols.preferredIntensity[guest] = 100;
  world.guests.cols.nauseaTolerance[guest] = 255;
  const gentle = openRide(world, RideType.MerryGoRound, [8, 4], [8, 5], [9, 4], [[7, 5]]);
  const thrill = openRide(world, RideType.SwingingShip, [12, 4], [12, 5], [13, 4], [[11, 5]]);
  world.rides.cols.excitement[gentle] = 500;
  world.rides.cols.excitement[thrill] = 650;
  world.rides.cols.intensity[gentle] = 450;
  world.rides.cols.intensity[thrill] = 450;
  world.rides.cols.nausea[gentle] = 0;
  world.rides.cols.nausea[thrill] = 0;
  world.weather.kind = weather;
  if (umbrella) world.umbrellas[world.guests.slotToId[guest]] = 1;
  createGuestSystem(() => ({ parkRating: 0, entranceFee: 0 })).update(world);
  return {
    selected: world.guests.cols.targetRide[guest],
    gentleId: world.rides.slotToId[gentle],
    thrillId: world.rides.slotToId[thrill],
  };
}

describe('weather guest behaviour', () => {
  it('shifts ride choice away from thrill rides in rain unless the guest has an umbrella', () => {
    const sunny = chooseRide(WeatherKind.Sunny, false);
    expect(sunny.selected).toBe(sunny.thrillId);

    const rainy = chooseRide(WeatherKind.Rain, false);
    expect(rainy.selected).toBe(rainy.gentleId);

    const sheltered = chooseRide(WeatherKind.Rain, true);
    expect(sheltered.selected).toBe(sheltered.thrillId);
  });

  it('sells one umbrella to a wet guest who walks up to an open kiosk', () => {
    const world = flatWorld(16, 7);
    layPath(world, row(8, 4, 10));
    const guest = guestAt(world, 4, 8);
    const kioskId = createRide(world, RideType.InformationKiosk, 10, 7);
    const kiosk = world.rides.idToSlot[kioskId];
    world.rides.cols.state[kiosk] = RideState.Open;
    world.rides.cols.entrancePlaced[kiosk] = 1;
    world.rides.cols.entranceX[kiosk] = 10;
    world.rides.cols.entranceY[kiosk] = 8;
    world.rides.cols.price[kiosk] = 75;
    world.weather.kind = WeatherKind.Rain;
    const cash = world.guests.cols.cash[guest];
    const update = createGuestSystem(() => ({ parkRating: 0, entranceFee: 0 }));

    const startX = world.guests.cols.x[guest];
    for (let tick = 0; tick < 1200; tick++) {
      update.update(world);
      world.tick++;
    }

    expect(world.guests.cols.x[guest]).toBeGreaterThan(startX);
    expect(world.rides.cols.guestsServed[kiosk]).toBe(1);
    expect(world.guests.cols.state[guest]).toBe(GuestState.Wandering);
    expect(world.umbrellas[world.guests.slotToId[guest]]).toBe(1);
    expect(world.guests.cols.cash[guest]).toBe(cash - 75);
    expect(world.economy.monthlyTotals[LedgerCategory.ShopSales]).toBe(75);
  });

  it('does not sell umbrellas from a closed or unaffordable kiosk', () => {
    for (const state of [RideState.Closed, RideState.Open]) {
      const world = flatWorld(16, 9);
      layPath(world, [[8, 8]]);
      const guest = guestAt(world, 8, 8);
      const kioskId = createRide(world, RideType.InformationKiosk, 8, 7);
      const kiosk = world.rides.idToSlot[kioskId];
      world.rides.cols.state[kiosk] = state;
      world.rides.cols.entrancePlaced[kiosk] = 1;
      world.rides.cols.entranceX[kiosk] = 8;
      world.rides.cols.entranceY[kiosk] = 8;
      world.rides.cols.price[kiosk] = state === RideState.Open ? 100_000 : 0;
      world.weather.kind = WeatherKind.Rain;
      const cash = world.guests.cols.cash[guest];

      createGuestSystem(() => ({ parkRating: 0, entranceFee: 0 })).update(world);

      expect(world.umbrellas[world.guests.slotToId[guest]]).toBe(0);
      expect(world.guests.cols.cash[guest]).toBe(cash);
    }
  });
});

describe('rain shelters', () => {
  function soakedGuest(shelter: boolean): number {
    const world = flatWorld(12, 4);
    layPath(world, [[5, 5]]);
    if (shelter) setPathAddition(world.map, 5, 5, PathAddition.Shelter);
    const guest = guestAt(world, 5, 5);
    for (let i = 0; i < 2; i++) {
      const slot = world.litter.spawn();
      world.litter.cols.x[slot] = 5 * TILE_UNITS + TILE_UNITS / 2;
      world.litter.cols.y[slot] = 5 * TILE_UNITS + TILE_UNITS / 2;
    }
    world.guests.cols.happiness[guest] = 200;
    world.weather.kind = WeatherKind.Rain;
    const system = createGuestSystem(() => ({ parkRating: 0, entranceFee: 0 }));
    for (let i = 0; i < 400; i++) {
      system.update(world);
      world.tick++;
    }
    return world.guests.cols.happiness[guest];
  }

  it('does not change happiness based on rain exposure', () => {
    expect(soakedGuest(false)).toBe(200);
    expect(soakedGuest(true)).toBe(200);
  });
});
