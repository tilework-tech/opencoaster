/**
 * What stalls sell. Costs, values and starting prices follow the RCT2 shop-item table (see
 * docs/mechanics/economy.md); all money is integer cents.
 */
export const enum ShopItem {
  None = 0,
  Balloon = 1,
  Map = 2,
  Umbrella = 3,
  Drink = 4,
  Burger = 5,
  Chips = 6,
  IceCream = 7,
  Candyfloss = 8,
  Pizza = 9,
  Popcorn = 10,
  Hat = 11,
  TShirt = 12,
}

export type ShopItemKind = 'food' | 'drink' | 'souvenir';

/** What a guest leaves behind after finishing an item. */
export const enum Container {
  None = 0,
  Rubbish = 1,
  Can = 2,
  BurgerBox = 3,
}

export interface ShopItemDef {
  id: ShopItem;
  name: string;
  kind: ShopItemKind;
  /** Stock cost charged for every sale. */
  costCents: number;
  /** What guests think the item is worth in mild weather, when it is warm, and when it is cold. */
  baseValueCents: number;
  hotValueCents: number;
  coldValueCents: number;
  defaultPriceCents: number;
  /** Ticks a guest takes to finish the item; zero for souvenirs. */
  consumeTicks: number;
  container: Container;
}

/** Guests value items at their hot value from this temperature (degrees Celsius) up, cold value from the lower bound down. */
export const WARM_ITEM_TEMPERATURE = 21;
export const COLD_ITEM_TEMPERATURE = 11;
/** Ice cream is never bought below this temperature. */
export const ICE_CREAM_MIN_TEMPERATURE = 12;

function item(
  id: ShopItem,
  name: string,
  kind: ShopItemKind,
  costCents: number,
  baseValueCents: number,
  hotValueCents: number,
  coldValueCents: number,
  defaultPriceCents: number,
  consumeTicks = 0,
  container = Container.None,
): ShopItemDef {
  return {
    id,
    name,
    kind,
    costCents,
    baseValueCents,
    hotValueCents,
    coldValueCents,
    defaultPriceCents,
    consumeTicks,
    container,
  };
}

export const SHOP_ITEMS: Readonly<Record<ShopItem, ShopItemDef>> = {
  [ShopItem.None]: item(ShopItem.None, 'Nothing', 'souvenir', 0, 0, 0, 0, 0),
  [ShopItem.Balloon]: item(ShopItem.Balloon, 'Balloon', 'souvenir', 30, 140, 140, 140, 90),
  [ShopItem.Map]: item(ShopItem.Map, 'Park Map', 'souvenir', 10, 70, 70, 80, 60),
  [ShopItem.Umbrella]: item(ShopItem.Umbrella, 'Umbrella', 'souvenir', 200, 350, 250, 500, 250),
  [ShopItem.Drink]: item(
    ShopItem.Drink,
    'Drink',
    'drink',
    30,
    120,
    200,
    100,
    120,
    100,
    Container.Can,
  ),
  [ShopItem.Burger]: item(
    ShopItem.Burger,
    'Burger',
    'food',
    50,
    190,
    190,
    220,
    150,
    150,
    Container.BurgerBox,
  ),
  [ShopItem.Chips]: item(
    ShopItem.Chips,
    'Chips',
    'food',
    40,
    160,
    160,
    180,
    150,
    120,
    Container.Rubbish,
  ),
  [ShopItem.IceCream]: item(ShopItem.IceCream, 'Ice Cream', 'food', 40, 100, 150, 60, 90, 60),
  [ShopItem.Candyfloss]: item(ShopItem.Candyfloss, 'Candyfloss', 'food', 30, 90, 90, 60, 80, 50),
  [ShopItem.Pizza]: item(
    ShopItem.Pizza,
    'Pizza',
    'food',
    60,
    210,
    210,
    250,
    160,
    150,
    Container.Rubbish,
  ),
  [ShopItem.Popcorn]: item(
    ShopItem.Popcorn,
    'Popcorn',
    'food',
    50,
    130,
    130,
    110,
    120,
    75,
    Container.Rubbish,
  ),
  [ShopItem.Hat]: item(ShopItem.Hat, 'Hat', 'souvenir', 90, 270, 320, 240, 150),
  [ShopItem.TShirt]: item(ShopItem.TShirt, 'T-Shirt', 'souvenir', 200, 370, 370, 370, 300),
};

export function shopItemDef(id: ShopItem): ShopItemDef {
  return SHOP_ITEMS[id];
}

export function itemValueAtTemperature(id: ShopItem, temperature: number): number {
  const def = shopItemDef(id);
  if (temperature >= WARM_ITEM_TEMPERATURE) return def.hotValueCents;
  if (temperature <= COLD_ITEM_TEMPERATURE) return def.coldValueCents;
  return def.baseValueCents;
}

/** Ticks of eating that pass in one consumption step, and what each step does to a guest. */
const CONSUME_STEP_TICKS = 3;
const FOOD_HUNGER_PER_STEP = 7;
const FOOD_THIRST_PER_STEP = -3;
const FOOD_TOILET_PER_STEP = 2;
const DRINK_THIRST_PER_STEP = 7;

export interface ConsumptionRelief {
  hunger: number;
  thirst: number;
  toilet: number;
}

/** Total change to hunger, thirst and toilet needs from finishing the item, before capping at 0..255. */
export function consumptionRelief(id: ShopItem): ConsumptionRelief {
  const def = shopItemDef(id);
  const steps = Math.ceil(def.consumeTicks / CONSUME_STEP_TICKS);
  if (def.kind === 'food') {
    return {
      hunger: steps * FOOD_HUNGER_PER_STEP,
      thirst: steps * FOOD_THIRST_PER_STEP,
      toilet: steps * FOOD_TOILET_PER_STEP,
    };
  }
  if (def.kind === 'drink') return { hunger: 0, thirst: steps * DRINK_THIRST_PER_STEP, toilet: 0 };
  return { hunger: 0, thirst: 0, toilet: 0 };
}
