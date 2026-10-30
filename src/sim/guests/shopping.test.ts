import { describe, expect, it } from 'vitest';
import { LedgerCategory } from '../economy/ledger';
import { flatWorld, guestAt, layPath, openRide, row } from '../integration/fixtures';
import { RideType } from '../rides/ride-types';
import { rideSystem } from '../rides/ride-system';
import { rideQueueSystem } from '../rides/queue-system';
import type { World } from '../core/world';
import { WeatherKind } from '../weather/weather';
import { guestSystem } from './guest-system';
import { LitterKind } from './litter-store';
import { litterSystem } from './litter-system';
import { PathAddition, setPathAddition } from '../map/paths';
import { Souvenir } from './guest-store';
import { goodDealHappiness } from './shopping';
import { itemValueCents } from './willingness';

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    rideSystem.update(w);
    rideQueueSystem.update(w);
    guestSystem.update(w);
    w.tick++;
  }
}

function runUntil(w: World, done: () => boolean, limit = 3000): void {
  for (let i = 0; i < limit && !done(); i++) run(w, 1);
  expect(done()).toBe(true);
}

function stallWorld(type: RideType, temperature = 17): { w: World; stall: number } {
  const w = flatWorld();
  layPath(w, row(5, 2, 20));
  const stall = openRide(w, type, [9, 4], [9, 5], [10, 4]);
  w.weather.temperature = temperature;
  w.weather.ticksUntilChange = 1_000_000;
  return { w, stall };
}

/** A guest with plenty of cash, a settled mood and every need met except the one under test. */
function settledGuest(w: World, x = 4, y = 5): number {
  const slot = guestAt(w, x, y);
  const g = w.guests.cols;
  g.cash[slot] = 5000;
  g.happiness[slot] = 100;
  g.happinessTarget[slot] = 100;
  g.hunger[slot] = 200;
  g.thirst[slot] = 200;
  g.toilet[slot] = 0;
  g.nausea[slot] = 0;
  g.energy[slot] = 128;
  g.ridesTaken[slot] = 5;
  return slot;
}

describe('item prices and value', () => {
  it('values a drink at its hot value on a warm day and its cold value on a cold one', () => {
    const { w, stall } = stallWorld(RideType.DrinkStall, 25);
    expect(itemValueCents(w, stall, 0)).toBe(200);
    w.weather.temperature = 5;
    expect(itemValueCents(w, stall, 0)).toBe(100);
    w.weather.temperature = 16;
    expect(itemValueCents(w, stall, 0)).toBe(120);
  });

  it('opens each stall at the default price of its items', () => {
    const { w, stall } = stallWorld(RideType.InformationKiosk);
    expect(w.rides.cols.price[stall]).toBe(60);
    expect(w.rides.cols.price2[stall]).toBe(250);
    const ice = stallWorld(RideType.IceCreamStall);
    expect(ice.w.rides.cols.price[ice.stall]).toBe(90);
    expect(ice.w.rides.cols.price2[ice.stall]).toBe(0);
  });
});

describe('buying food and drink', () => {
  it('sells ice cream on a warm day: relief from the eating time, stock cost, sales and happiness', () => {
    const { w, stall } = stallWorld(RideType.IceCreamStall, 25);
    const slot = settledGuest(w);
    const g = w.guests.cols;
    g.hunger[slot] = 10;
    g.thirst[slot] = 220;
    g.toilet[slot] = 20;
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    // 60 ticks of eating -> 20 steps: +140 hunger, -60 thirst, +40 toilet
    // (needs also drift by a couple of points while the guest walks to the stall)
    expect(g.hunger[slot]).toBeGreaterThanOrEqual(144);
    expect(g.hunger[slot]).toBeLessThanOrEqual(150);
    expect(g.thirst[slot]).toBeGreaterThanOrEqual(155);
    expect(g.thirst[slot]).toBeLessThanOrEqual(160);
    expect(g.toilet[slot]).toBeGreaterThanOrEqual(60);
    expect(g.cash[slot]).toBe(5000 - 90);
    expect(w.economy.monthlyTotals[LedgerCategory.FoodDrinkSales]).toBe(90);
    expect(w.economy.monthlyTotals[LedgerCategory.FoodDrinkStock]).toBe(-40);
    // ice cream is worth 150 hot and sold for 90, so the 60c gap is under the 80c floor: +4 x 8
    expect(g.happinessTarget[slot]).toBeGreaterThanOrEqual(100 + 32);
    expect(g.container[slot]).toBe(0);
  });

  it('records sales, takings and profit for the item sold', () => {
    const { w, stall } = stallWorld(RideType.IceCreamStall, 25);
    settledGuest(w).valueOf();
    w.guests.cols.hunger[0] = 10;
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    expect(w.rides.cols.itemSold0[stall]).toBe(1);
    expect(w.rides.cols.itemRevenue0[stall]).toBe(90);
    expect(w.rides.cols.itemSold1[stall]).toBe(0);
  });

  it('gives a burger buyer a full stomach, a dry mouth and a burger box to drop', () => {
    const { w, stall } = stallWorld(RideType.BurgerStall);
    const slot = settledGuest(w);
    const g = w.guests.cols;
    g.hunger[slot] = 10;
    g.thirst[slot] = 200;
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    // 150 ticks of eating -> 50 steps: hunger capped at 255, thirst -150
    expect(g.hunger[slot]).toBe(255);
    expect(g.thirst[slot]).toBe(50);
    expect(g.container[slot]).not.toBe(0);
  });

  it('refuses ice cream below 12 C even to a hungry guest', () => {
    const { w, stall } = stallWorld(RideType.IceCreamStall, 11);
    const slot = settledGuest(w);
    w.guests.cols.hunger[slot] = 10;
    run(w, 1500);
    expect(w.rides.cols.guestsServed[stall]).toBe(0);
  });

  it.each([
    ['ice cream', RideType.IceCreamStall],
    ['candyfloss', RideType.CandyflossStall],
  ])('refuses %s in the rain', (_name, type) => {
    const { w, stall } = stallWorld(type, 22);
    w.weather.kind = WeatherKind.Rain;
    const slot = settledGuest(w);
    w.guests.cols.hunger[slot] = 10;
    run(w, 1500);
    expect(w.rides.cols.guestsServed[stall]).toBe(0);
  });

  it('does not buy food above the hunger threshold of 75', () => {
    const { w, stall } = stallWorld(RideType.BurgerStall);
    const slot = settledGuest(w);
    w.guests.cols.hunger[slot] = 90;
    run(w, 1500);
    expect(w.rides.cols.guestsServed[stall]).toBe(0);
  });

  it('does not buy a drink above the thirst threshold of 75', () => {
    const { w, stall } = stallWorld(RideType.DrinkStall, 25);
    const slot = settledGuest(w);
    w.guests.cols.thirst[slot] = 90;
    run(w, 1500);
    expect(w.rides.cols.guestsServed[stall]).toBe(0);
  });

  it('does not eat when too nauseous', () => {
    const { w, stall } = stallWorld(RideType.BurgerStall);
    const slot = settledGuest(w);
    w.guests.cols.hunger[slot] = 10;
    w.guests.cols.nausea[slot] = 250;
    run(w, 1500);
    expect(w.rides.cols.guestsServed[stall]).toBe(0);
  });

  it('keeps empty containers until a litter check drops them on the path', () => {
    const w = flatWorld();
    layPath(w, row(5, 2, 20));
    const slot = guestAt(w, 6, 5);
    const g = w.guests.cols;
    g.container[slot] = 2;
    let tick = 0;
    for (; tick < 160 * 400 && g.container[slot] !== 0; tick += 160) {
      w.tick = tick;
      litterSystem.update(w);
    }
    expect(g.container[slot]).toBe(0);
    const kinds = Array.from(w.litter.cols.kind.subarray(0, w.litter.count));
    expect(kinds).toContain(LitterKind.Can);
  });
});

describe('good-deal happiness', () => {
  it('is four per tenth of the saving once it passes the 80c floor', () => {
    expect(goodDealHappiness(140, 90)).toBe(32);
    expect(goodDealHappiness(200, 50)).toBe(60);
    expect(goodDealHappiness(350, 250)).toBe(40);
    expect(goodDealHappiness(100, 100)).toBe(32);
  });
});

describe('using bins', () => {
  it('puts an empty container in the bin on the tile the guest stands at instead of dropping it', () => {
    const w = flatWorld();
    layPath(w, row(5, 2, 20));
    setPathAddition(w.map, 8, 5, PathAddition.Bin);
    const slot = guestAt(w, 8, 5);
    w.guests.cols.container[slot] = 3;
    run(w, 8);
    const bin = w.map.pathElement(w.map.index(8, 5), -1);
    expect(w.guests.cols.container[slot]).toBe(0);
    expect(w.map.elData[bin] & 0xff).toBe(0xfe);
    expect(w.litter.count).toBe(0);
  });

  it('keeps the container when the bin is full', () => {
    const w = flatWorld();
    layPath(w, row(5, 2, 20));
    setPathAddition(w.map, 8, 5, PathAddition.Bin);
    w.map.elData[w.map.pathElement(w.map.index(8, 5), -1)] = 0;
    const slot = guestAt(w, 8, 5);
    w.guests.cols.container[slot] = 3;
    run(w, 8);
    expect(w.guests.cols.container[slot]).toBe(3);
  });
});

describe('buying souvenirs', () => {
  it('sells a balloon to a happy, experienced guest, who then carries it', () => {
    const { w, stall } = stallWorld(RideType.BalloonStall);
    const slot = settledGuest(w);
    const g = w.guests.cols;
    g.happiness[slot] = 255;
    g.happinessTarget[slot] = 100;
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1, 6000);
    expect(g.souvenirs[slot] & Souvenir.Balloon).toBe(Souvenir.Balloon);
    expect(g.cash[slot]).toBe(5000 - 90);
    expect(w.economy.monthlyTotals[LedgerCategory.ShopSales]).toBe(90);
    expect(w.economy.monthlyTotals[LedgerCategory.ShopStock]).toBe(-30);
    expect(g.happinessTarget[slot]).toBeGreaterThanOrEqual(132);
  });

  it('does not sell souvenirs to a guest with fewer than three rides', () => {
    const { w, stall } = stallWorld(RideType.BalloonStall);
    const slot = settledGuest(w);
    w.guests.cols.happiness[slot] = 255;
    w.guests.cols.ridesTaken[slot] = 2;
    run(w, 4000);
    expect(w.rides.cols.guestsServed[stall]).toBe(0);
  });

  it('does not sell a second balloon to a guest who already has one', () => {
    const { w, stall } = stallWorld(RideType.BalloonStall);
    const slot = settledGuest(w);
    w.guests.cols.happiness[slot] = 255;
    w.guests.cols.souvenirs[slot] = Souvenir.Balloon;
    run(w, 4000);
    expect(w.rides.cols.guestsServed[stall]).toBe(0);
  });

  it('sells hats and T-shirts into different carried slots', () => {
    const hat = stallWorld(RideType.HatStall);
    const hatSlot = settledGuest(hat.w);
    hat.w.guests.cols.happiness[hatSlot] = 255;
    runUntil(hat.w, () => hat.w.rides.cols.guestsServed[hat.stall] === 1, 6000);
    expect(hat.w.guests.cols.souvenirs[hatSlot]).toBe(Souvenir.Hat);

    const shirt = stallWorld(RideType.SouvenirStall);
    const shirtSlot = settledGuest(shirt.w);
    shirt.w.guests.cols.happiness[shirtSlot] = 255;
    shirt.w.guests.cols.cash[shirtSlot] = 5000;
    runUntil(shirt.w, () => shirt.w.rides.cols.guestsServed[shirt.stall] === 1, 6000);
    expect(shirt.w.guests.cols.souvenirs[shirtSlot]).toBe(Souvenir.TShirt);
  });

  it('refuses a hat priced far above its value', () => {
    const { w, stall } = stallWorld(RideType.HatStall);
    w.rides.cols.price[stall] = 900;
    const slot = settledGuest(w);
    w.guests.cols.happiness[slot] = 255;
    run(w, 4000);
    expect(w.rides.cols.guestsServed[stall]).toBe(0);
  });
});

describe('information kiosk items', () => {
  it('sells a wet guest an umbrella at the second price, and charges its stock cost', () => {
    const { w, stall } = stallWorld(RideType.InformationKiosk);
    w.weather.kind = WeatherKind.Rain;
    w.rides.cols.price2[stall] = 75;
    const slot = settledGuest(w);
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    expect(w.umbrellas[w.guests.slotToId[slot]]).toBe(1);
    expect(w.guests.cols.cash[slot]).toBe(5000 - 75);
    expect(w.economy.monthlyTotals[LedgerCategory.ShopSales]).toBe(75);
    expect(w.economy.monthlyTotals[LedgerCategory.ShopStock]).toBe(-200);
    expect(w.rides.cols.itemSold1[stall]).toBe(1);
    expect(w.rides.cols.itemRevenue1[stall]).toBe(75);
  });

  it('still buys an umbrella in the rain when it costs more than it is worth', () => {
    const { w, stall } = stallWorld(RideType.InformationKiosk);
    w.weather.kind = WeatherKind.Rain;
    w.rides.cols.price2[stall] = 900;
    const slot = settledGuest(w);
    w.guests.cols.cash[slot] = 5000;
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    expect(w.umbrellas[w.guests.slotToId[slot]]).toBe(1);
  });

  it('sells a lost guest a park map at the first price', () => {
    const { w, stall } = stallWorld(RideType.InformationKiosk);
    w.rides.cols.price[stall] = 40;
    const slot = settledGuest(w);
    w.guests.cols.lostTicks[slot] = 2400;
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    expect(w.guests.cols.hasMap[slot]).toBe(1);
    expect(w.guests.cols.cash[slot]).toBe(5000 - 40);
    expect(w.rides.cols.itemSold0[stall]).toBe(1);
    expect(w.economy.monthlyTotals[LedgerCategory.ShopStock]).toBe(-10);
  });
});
