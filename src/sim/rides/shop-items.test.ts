import { describe, expect, it } from 'vitest';
import {
  COLD_ITEM_TEMPERATURE,
  SHOP_ITEMS,
  ShopItem,
  WARM_ITEM_TEMPERATURE,
  consumptionRelief,
  itemValueAtTemperature,
} from './shop-items';

describe('shop item catalog', () => {
  it.each([
    // item, cost, base, hot, cold, default price (cents) from the RCT2 item table
    [ShopItem.Balloon, 30, 140, 140, 140, 90],
    [ShopItem.Map, 10, 70, 70, 80, 60],
    [ShopItem.Umbrella, 200, 350, 250, 500, 250],
    [ShopItem.Drink, 30, 120, 200, 100, 120],
    [ShopItem.Burger, 50, 190, 190, 220, 150],
    [ShopItem.Chips, 40, 160, 160, 180, 150],
    [ShopItem.IceCream, 40, 100, 150, 60, 90],
    [ShopItem.Candyfloss, 30, 90, 90, 60, 80],
    [ShopItem.Pizza, 60, 210, 210, 250, 160],
    [ShopItem.Popcorn, 50, 130, 130, 110, 120],
    [ShopItem.Hat, 90, 270, 320, 240, 150],
    [ShopItem.TShirt, 200, 370, 370, 370, 300],
  ])(
    'item %i costs %i and is worth %i / %i / %i, selling for %i',
    (item, cost, base, hot, cold, price) => {
      const def = SHOP_ITEMS[item];
      expect([def.costCents, def.baseValueCents, def.hotValueCents, def.coldValueCents]).toEqual([
        cost,
        base,
        hot,
        cold,
      ]);
      expect(def.defaultPriceCents).toBe(price);
    },
  );

  it('values a drink at its hot, base or cold value by temperature', () => {
    expect(itemValueAtTemperature(ShopItem.Drink, WARM_ITEM_TEMPERATURE)).toBe(200);
    expect(itemValueAtTemperature(ShopItem.Drink, WARM_ITEM_TEMPERATURE - 1)).toBe(120);
    expect(itemValueAtTemperature(ShopItem.Drink, COLD_ITEM_TEMPERATURE + 1)).toBe(120);
    expect(itemValueAtTemperature(ShopItem.Drink, COLD_ITEM_TEMPERATURE)).toBe(100);
  });

  it('values ice cream higher in the heat and lower in the cold', () => {
    expect(itemValueAtTemperature(ShopItem.IceCream, 25)).toBe(150);
    expect(itemValueAtTemperature(ShopItem.IceCream, 5)).toBe(60);
  });

  it('classifies items as food, drink or souvenir', () => {
    expect(SHOP_ITEMS[ShopItem.Burger].kind).toBe('food');
    expect(SHOP_ITEMS[ShopItem.Drink].kind).toBe('drink');
    expect(SHOP_ITEMS[ShopItem.Balloon].kind).toBe('souvenir');
    expect(SHOP_ITEMS[ShopItem.Map].kind).toBe('souvenir');
  });

  it('works out hunger relief from the time to eat: 7 per 3 ticks, rounded up, capped at a full stomach', () => {
    // ice cream: 60 ticks -> 20 steps -> 140
    expect(consumptionRelief(ShopItem.IceCream)).toEqual({ hunger: 140, thirst: -60, toilet: 40 });
    // candyfloss: 50 ticks -> 17 steps -> 119
    expect(consumptionRelief(ShopItem.Candyfloss)).toEqual({
      hunger: 119,
      thirst: -51,
      toilet: 34,
    });
    // burger: 150 ticks -> 50 steps -> 350, capped at 255 by the guest's need byte
    expect(consumptionRelief(ShopItem.Burger).hunger).toBe(350);
    // a drink only quenches thirst: 100 ticks -> 34 steps -> 238
    expect(consumptionRelief(ShopItem.Drink)).toEqual({ hunger: 0, thirst: 238, toilet: 0 });
  });

  it('has no relief for souvenirs', () => {
    expect(consumptionRelief(ShopItem.Hat)).toEqual({ hunger: 0, thirst: 0, toilet: 0 });
  });
});
