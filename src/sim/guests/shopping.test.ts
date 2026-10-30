import { describe, expect, it } from 'vitest';
import { LedgerCategory } from '../economy/ledger';
import { flatWorld, guestAt, layPath, openRide, row } from '../integration/fixtures';
import { RideState } from '../rides/ride-store';
import { RideType } from '../rides/ride-types';
import { rideSystem } from '../rides/ride-system';
import { rideQueueSystem } from '../rides/queue-system';
import { Container } from '../rides/shop-items';
import type { World } from '../core/world';
import { PathAddition, setPathAddition } from '../map/paths';
import { WeatherKind } from '../weather/weather';
import { guestSystem } from './guest-system';
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

function runUntil(w: World, done: () => boolean, limit = 400): void {
  for (let i = 0; i < limit && !done(); i++) run(w, 1);
  expect(done()).toBe(true);
}

const STALL_ENTRANCE: [number, number] = [9, 5];

/**
 * A path with one open stall whose entrance is at (9, 5). The clock starts where no need-decay or
 * mood update falls in the next 70 ticks, so a guest's needs only change by what they buy.
 */
function stallWorld(type: RideType, temperature = 17): { w: World; stall: number } {
  const w = flatWorld();
  layPath(w, row(5, 2, 20));
  const stall = openRide(w, type, [9, 4], STALL_ENTRANCE, [10, 4]);
  w.weather.temperature = temperature;
  w.weather.ticksUntilChange = 1_000_000;
  w.tick = 130;
  return { w, stall };
}

/**
 * A guest standing at the stall's entrance, headed for it, with plenty of cash and a settled mood
 * and every need met except the one under test.
 */
function guestAtStall(w: World, stall: number): number {
  const slot = guestAt(w, ...STALL_ENTRANCE);
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
  g.targetRide[slot] = w.rides.slotToId[stall];
  g.targetX[slot] = w.rides.cols.entranceX[stall];
  g.targetY[slot] = w.rides.cols.entranceY[stall];
  return slot;
}

/** Items sold by a stall after a guest prepared by `prepare` walks up to it. */
function soldAfter(
  type: RideType,
  prepare: (w: World, slot: number, stall: number) => void,
  temperature = 17,
): number {
  const { w, stall } = stallWorld(type, temperature);
  const slot = guestAtStall(w, stall);
  prepare(w, slot, stall);
  run(w, 100);
  return w.rides.cols.guestsServed[stall];
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
    const kiosk = stallWorld(RideType.InformationKiosk);
    expect(kiosk.w.rides.cols.price[kiosk.stall]).toBe(60);
    expect(kiosk.w.rides.cols.price2[kiosk.stall]).toBe(250);
    const ice = stallWorld(RideType.IceCreamStall);
    expect(ice.w.rides.cols.price[ice.stall]).toBe(90);
    expect(ice.w.rides.cols.price2[ice.stall]).toBe(0);
  });
});

describe('buying food and drink', () => {
  it('sells ice cream on a warm day: relief from the eating time, stock cost, sales and happiness', () => {
    const { w, stall } = stallWorld(RideType.IceCreamStall, 25);
    const slot = guestAtStall(w, stall);
    const g = w.guests.cols;
    g.hunger[slot] = 10;
    g.thirst[slot] = 220;
    g.toilet[slot] = 20;
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    // 60 ticks of eating -> 20 steps: +140 hunger, -60 thirst, +40 toilet
    expect([g.hunger[slot], g.thirst[slot], g.toilet[slot]]).toEqual([150, 160, 60]);
    expect(g.cash[slot]).toBe(5000 - 90);
    expect(w.economy.monthlyTotals[LedgerCategory.FoodDrinkSales]).toBe(90);
    expect(w.economy.monthlyTotals[LedgerCategory.FoodDrinkStock]).toBe(-40);
    // worth 150 hot, sold for 90: the 60c gap is under the 80c floor, so +4 x 8
    expect(g.happinessTarget[slot]).toBe(132);
    expect(g.happiness[slot]).toBe(132);
    expect(g.container[slot]).toBe(Container.None);
    expect(w.rides.cols.itemSold0[stall]).toBe(1);
    expect(w.rides.cols.itemRevenue0[stall]).toBe(90);
    expect(w.rides.cols.itemSold1[stall]).toBe(0);
  });

  it.each([
    [RideType.CandyflossStall, 'candyfloss', 50, [129, 169, 54]],
    [RideType.PopcornStall, 'popcorn', 75, [185, 145, 70]],
  ] as const)(
    'feeds a %s buyer by its eating time, and leaves a wrapper for popcorn',
    (type, _name, _ticks, [hunger, thirst, toilet]) => {
      const { w, stall } = stallWorld(type, 17);
      const slot = guestAtStall(w, stall);
      const g = w.guests.cols;
      g.hunger[slot] = 10;
      g.thirst[slot] = 220;
      g.toilet[slot] = 20;
      runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
      // candyfloss: 17 steps -> +119, -51, +34; popcorn: 25 steps -> +175, -75, +50
      expect([g.hunger[slot], g.thirst[slot], g.toilet[slot]]).toEqual([hunger, thirst, toilet]);
      expect(g.container[slot]).toBe(type === RideType.PopcornStall ? Container.Rubbish : 0);
    },
  );

  it('gives a burger buyer a full stomach, a dry mouth and a burger box to drop', () => {
    const { w, stall } = stallWorld(RideType.BurgerStall);
    const slot = guestAtStall(w, stall);
    const g = w.guests.cols;
    g.hunger[slot] = 10;
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    // 150 ticks of eating -> 50 steps: hunger capped at 255, thirst -150, toilet +100
    expect([g.hunger[slot], g.thirst[slot], g.toilet[slot]]).toEqual([255, 50, 100]);
    expect(g.container[slot]).toBe(Container.BurgerBox);
  });

  it('gives a drink buyer a can to drop', () => {
    const { w, stall } = stallWorld(RideType.DrinkStall, 17);
    const slot = guestAtStall(w, stall);
    w.guests.cols.thirst[slot] = 10;
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    // 100 ticks of eating -> 34 steps of +7, capped at 255
    expect(w.guests.cols.thirst[slot]).toBe(248);
    expect(w.guests.cols.container[slot]).toBe(Container.Can);
  });

  describe('refusals, each with the nearest sale as a control', () => {
    it('buys ice cream at 12 C and refuses it at 11 C', () => {
      const hungry = (w: World, slot: number) => (w.guests.cols.hunger[slot] = 10);
      expect(soldAfter(RideType.IceCreamStall, hungry, 12)).toBe(1);
      expect(soldAfter(RideType.IceCreamStall, hungry, 11)).toBe(0);
    });

    it.each([
      [RideType.IceCreamStall, 'ice cream'],
      [RideType.CandyflossStall, 'candyfloss'],
    ])('refuses %s in the rain but not in the sun', (type) => {
      const hungry = (w: World, slot: number) => (w.guests.cols.hunger[slot] = 10);
      const rainy = (w: World, slot: number) => {
        hungry(w, slot);
        w.weather.kind = WeatherKind.Rain;
      };
      expect(soldAfter(type, hungry, 22)).toBe(1);
      expect(soldAfter(type, rainy, 22)).toBe(0);
    });

    it('buys food at hunger 75 and refuses it at 76', () => {
      const hunger = (value: number) => (w: World, slot: number) =>
        (w.guests.cols.hunger[slot] = value);
      expect(soldAfter(RideType.BurgerStall, hunger(75))).toBe(1);
      expect(soldAfter(RideType.BurgerStall, hunger(76))).toBe(0);
    });

    it('buys a drink at thirst 75 and refuses it at 76', () => {
      const thirst = (value: number) => (w: World, slot: number) =>
        (w.guests.cols.thirst[slot] = value);
      expect(soldAfter(RideType.DrinkStall, thirst(75), 25)).toBe(1);
      expect(soldAfter(RideType.DrinkStall, thirst(76), 25)).toBe(0);
    });

    it('eats at nausea 144 and refuses food at 145', () => {
      const nauseous = (value: number) => (w: World, slot: number) => {
        w.guests.cols.hunger[slot] = 10;
        w.guests.cols.nausea[slot] = value;
      };
      expect(soldAfter(RideType.BurgerStall, nauseous(144))).toBe(1);
      expect(soldAfter(RideType.BurgerStall, nauseous(145))).toBe(0);
    });

    it('does not sell to a guest who cannot afford the item', () => {
      const cash = (value: number) => (w: World, slot: number) => {
        w.guests.cols.hunger[slot] = 10;
        w.guests.cols.cash[slot] = value;
      };
      expect(soldAfter(RideType.BurgerStall, cash(150))).toBe(1);
      expect(soldAfter(RideType.BurgerStall, cash(149))).toBe(0);
    });

    it('does not sell from a closed stall', () => {
      const close = (w: World, slot: number, stall: number) => {
        w.guests.cols.hunger[slot] = 10;
        w.rides.cols.state[stall] = RideState.Closed;
      };
      expect(soldAfter(RideType.BurgerStall, (w, slot) => (w.guests.cols.hunger[slot] = 10))).toBe(
        1,
      );
      expect(soldAfter(RideType.BurgerStall, close)).toBe(0);
    });
  });
});

describe('buying souvenirs', () => {
  const eager = (w: World, slot: number) => {
    w.guests.cols.happiness[slot] = 255;
  };

  it('sells a balloon to a happy, experienced guest, who then carries it', () => {
    const { w, stall } = stallWorld(RideType.BalloonStall);
    const slot = guestAtStall(w, stall);
    const g = w.guests.cols;
    eager(w, slot);
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    expect(g.souvenirs[slot]).toBe(Souvenir.Balloon);
    expect(g.cash[slot]).toBe(5000 - 90);
    expect(w.economy.monthlyTotals[LedgerCategory.ShopSales]).toBe(90);
    expect(w.economy.monthlyTotals[LedgerCategory.ShopStock]).toBe(-30);
    // worth 140, sold for 90: the 50c gap is under the 80c floor, so +4 x 8
    expect(g.happinessTarget[slot]).toBe(132);
  });

  it('needs at least three rides, and a mood the souvenir roll can beat', () => {
    const rides = (count: number) => (w: World, slot: number) => {
      eager(w, slot);
      w.guests.cols.ridesTaken[slot] = count;
    };
    expect(soldAfter(RideType.BalloonStall, rides(3))).toBe(1);
    expect(soldAfter(RideType.BalloonStall, rides(2))).toBe(0);
    // the roll adds at least 115 to its draw, so a guest at happiness 114 can never pass it
    expect(
      soldAfter(RideType.BalloonStall, (w, slot) => (w.guests.cols.happiness[slot] = 114)),
    ).toBe(0);
  });

  it('does not sell a second balloon to a guest who already has one', () => {
    const owns = (w: World, slot: number) => {
      eager(w, slot);
      w.guests.cols.souvenirs[slot] = Souvenir.Balloon;
    };
    expect(soldAfter(RideType.BalloonStall, eager)).toBe(1);
    expect(soldAfter(RideType.BalloonStall, owns)).toBe(0);
  });

  it.each([
    [RideType.HatStall, Souvenir.Hat, 150, 90],
    [RideType.SouvenirStall, Souvenir.TShirt, 300, 200],
  ])(
    'sells %i to a guest who then carries souvenir bit %i for $%i, costing $%i to stock',
    (type, bit, price, cost) => {
      const { w, stall } = stallWorld(type);
      const slot = guestAtStall(w, stall);
      eager(w, slot);
      runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
      expect(w.guests.cols.souvenirs[slot]).toBe(bit);
      expect(w.guests.cols.cash[slot]).toBe(5000 - price);
      expect(w.economy.monthlyTotals[LedgerCategory.ShopSales]).toBe(price);
      expect(w.economy.monthlyTotals[LedgerCategory.ShopStock]).toBe(-cost);
    },
  );

  it('refuses a hat priced far above its value', () => {
    const priced = (price: number) => (w: World, slot: number, stall: number) => {
      eager(w, slot);
      w.rides.cols.price[stall] = price;
    };
    expect(soldAfter(RideType.HatStall, priced(150))).toBe(1);
    expect(soldAfter(RideType.HatStall, priced(900))).toBe(0);
  });
});

describe('information kiosk items', () => {
  it('sells a wet guest an umbrella at the second price, and charges its stock cost', () => {
    const { w, stall } = stallWorld(RideType.InformationKiosk);
    w.weather.kind = WeatherKind.Rain;
    w.rides.cols.price2[stall] = 75;
    const slot = guestAtStall(w, stall);
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    expect(w.umbrellas[w.guests.slotToId[slot]]).toBe(1);
    expect(w.guests.cols.cash[slot]).toBe(5000 - 75);
    expect(w.economy.monthlyTotals[LedgerCategory.ShopSales]).toBe(75);
    expect(w.economy.monthlyTotals[LedgerCategory.ShopStock]).toBe(-200);
    expect(w.rides.cols.itemSold1[stall]).toBe(1);
    expect(w.rides.cols.itemRevenue1[stall]).toBe(75);
    expect(w.rides.cols.itemSold0[stall]).toBe(0);
  });

  it('still buys an umbrella in the rain when it costs more than it is worth', () => {
    const { w, stall } = stallWorld(RideType.InformationKiosk);
    w.weather.kind = WeatherKind.Rain;
    w.rides.cols.price2[stall] = 900;
    const slot = guestAtStall(w, stall);
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    expect(w.umbrellas[w.guests.slotToId[slot]]).toBe(1);
    expect(w.guests.cols.cash[slot]).toBe(5000 - 900);
    expect(w.economy.monthlyTotals[LedgerCategory.ShopSales]).toBe(900);
  });

  it('sells umbrellas only when it rains', () => {
    const rainy = (w: World) => (w.weather.kind = WeatherKind.Rain);
    expect(soldAfter(RideType.InformationKiosk, rainy)).toBe(1);
    expect(soldAfter(RideType.InformationKiosk, () => undefined)).toBe(0);
  });

  it('sells a park map only to a lost guest, at the first price', () => {
    const { w, stall } = stallWorld(RideType.InformationKiosk);
    w.rides.cols.price[stall] = 40;
    const slot = guestAtStall(w, stall);
    w.guests.cols.lostTicks[slot] = 2400;
    runUntil(w, () => w.rides.cols.guestsServed[stall] === 1);
    expect(w.guests.cols.hasMap[slot]).toBe(1);
    expect(w.guests.cols.cash[slot]).toBe(5000 - 40);
    expect(w.rides.cols.itemSold0[stall]).toBe(1);
    expect(w.economy.monthlyTotals[LedgerCategory.ShopStock]).toBe(-10);
    expect(soldAfter(RideType.InformationKiosk, () => undefined)).toBe(0);
  });
});

describe('good-deal happiness', () => {
  it('is four per tenth of the saving once it passes the 80c floor', () => {
    expect(goodDealHappiness(140, 90)).toBe(32);
    expect(goodDealHappiness(170, 90)).toBe(32);
    expect(goodDealHappiness(180, 90)).toBe(36);
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
    w.guests.cols.container[slot] = Container.BurgerBox;
    run(w, 8);
    const bin = w.map.pathElement(w.map.index(8, 5), -1);
    expect(w.guests.cols.container[slot]).toBe(Container.None);
    expect(w.map.elData[bin] & 0xff).toBe(0xfe);
    expect(w.litter.count).toBe(0);
  });
});
