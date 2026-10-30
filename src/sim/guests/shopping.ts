import type { World } from '../core/world';
import { charge, earn } from '../economy/api';
import { LedgerCategory } from '../economy/ledger';
import { addRideIncome } from '../rides/ride-operations';
import { RIDE_CATALOG } from '../rides/ride-types';
import type { RideType } from '../rides/ride-types';
import {
  ICE_CREAM_MIN_TEMPERATURE,
  ShopItem,
  consumptionRelief,
  itemValueAtTemperature,
  shopItemDef,
} from '../rides/shop-items';
import { WeatherKind } from '../weather/weather';
import { Souvenir } from './guest-store';

/** Food is only bought at or below this hunger, drink at or below this thirst (255 is full). */
export const FOOD_HUNGER_LIMIT = 75;
export const DRINK_THIRST_LIMIT = 75;
/** A guest this nauseous will not eat or drink. */
export const NAUSEA_REFUSES_ITEMS = 145;
/** Souvenirs need a guest who has ridden at least this many rides. */
export const SOUVENIR_MIN_RIDES = 3;
/** The souvenir roll adds this to a 0-127 draw and the guest must be at least that happy. */
const SOUVENIR_HAPPINESS_BASE = 0x73;
export const SOUVENIR_ROLLS = 0x80;
/** The floor, in cents, on how good a deal must look before it lifts the mood. */
const GOOD_DEAL_FLOOR_CENTS = 80;
const HAPPINESS_PER_TENTH = 4;
const CENTS_PER_TENTH = 10;
const MAX_NEED = 255;

export function stallItems(world: World, ride: number): readonly ShopItem[] {
  return RIDE_CATALOG[world.rides.cols.typeId[ride] as RideType]?.items ?? [];
}

export function itemPriceCents(world: World, ride: number, index: number): number {
  return index === 0 ? world.rides.cols.price[ride] : world.rides.cols.price2[ride];
}

function raining(world: World): boolean {
  return world.weather.kind >= WeatherKind.Rain;
}

export function ownsItem(world: World, slot: number, item: ShopItem): boolean {
  const g = world.guests.cols;
  switch (item) {
    case ShopItem.Balloon:
      return (g.souvenirs[slot] & Souvenir.Balloon) !== 0;
    case ShopItem.Hat:
      return (g.souvenirs[slot] & Souvenir.Hat) !== 0;
    case ShopItem.TShirt:
      return (g.souvenirs[slot] & Souvenir.TShirt) !== 0;
    case ShopItem.Umbrella:
      return world.umbrellas[world.guests.slotToId[slot]] === 1;
    case ShopItem.Map:
      return g.hasMap[slot] === 1;
    default:
      return false;
  }
}

/** Whether the guest's body and the weather allow buying `item` at all, whatever its price. */
export function itemAllowed(world: World, slot: number, item: ShopItem): boolean {
  const g = world.guests.cols;
  if (ownsItem(world, slot, item)) return false;
  const kind = shopItemDef(item).kind;
  if (kind !== 'souvenir' && g.nausea[slot] >= NAUSEA_REFUSES_ITEMS) return false;
  if (
    raining(world) &&
    (item === ShopItem.Balloon || item === ShopItem.IceCream || item === ShopItem.Candyfloss)
  )
    return false;
  if (item === ShopItem.IceCream && world.weather.temperature < ICE_CREAM_MIN_TEMPERATURE)
    return false;
  if (kind === 'food') return g.hunger[slot] <= FOOD_HUNGER_LIMIT;
  if (kind === 'drink') return g.thirst[slot] <= DRINK_THIRST_LIMIT;
  if (item === ShopItem.Umbrella) return raining(world);
  if (item === ShopItem.Map) return isLostWithoutMap(world, slot);
  return true;
}

export function isLostWithoutMap(world: World, slot: number): boolean {
  const g = world.guests.cols;
  return g.lostTicks[slot] > 0 && g.hasMap[slot] === 0;
}

/** What the guest thinks `item` is worth right now. */
export function itemValueNow(world: World, item: ShopItem): number {
  return itemValueAtTemperature(item, world.weather.temperature);
}

/** An umbrella in the rain and a map for a lost guest are bought whatever they cost. */
export function ignoresPrice(world: World, slot: number, item: ShopItem): boolean {
  return (
    (item === ShopItem.Umbrella && raining(world)) ||
    (item === ShopItem.Map && isLostWithoutMap(world, slot))
  );
}

/** Whether a souvenir sale passes the mood and experience roll (0 to 127). */
export function passesSouvenirRoll(
  world: World,
  slot: number,
  item: ShopItem,
  roll: number,
): boolean {
  if (item === ShopItem.Map || ignoresPrice(world, slot, item)) return true;
  const g = world.guests.cols;
  return (
    g.ridesTaken[slot] >= SOUVENIR_MIN_RIDES && roll + SOUVENIR_HAPPINESS_BASE <= g.happiness[slot]
  );
}

/**
 * Index of the first of the stall's items the guest wants right now, or -1. `kind` and `only`
 * narrow the search to what drew the guest to the stall.
 */
export function wantedItemIndex(
  world: World,
  slot: number,
  ride: number,
  kind?: 'food' | 'drink' | 'souvenir',
  only: ShopItem = ShopItem.None,
): number {
  const items = stallItems(world, ride);
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (only !== ShopItem.None && item !== only) continue;
    if (kind !== undefined && shopItemDef(item).kind !== kind) continue;
    if (!itemAllowed(world, slot, item)) continue;
    return index;
  }
  return -1;
}

/** The item a guest at the stall buys: a lost guest's map, a wet guest's umbrella, else the first they want; -1 for none. */
export function chooseStallItem(world: World, slot: number, ride: number): number {
  if (isLostWithoutMap(world, slot)) {
    const map = wantedItemIndex(world, slot, ride, undefined, ShopItem.Map);
    if (map >= 0) return map;
  }
  if (raining(world)) {
    const umbrella = wantedItemIndex(world, slot, ride, undefined, ShopItem.Umbrella);
    if (umbrella >= 0) return umbrella;
  }
  return wantedItemIndex(world, slot, ride);
}

function addCapped(value: number, delta: number): number {
  return Math.max(0, Math.min(MAX_NEED, value + delta));
}

/** Happiness a purchase worth at least its price gives: four per tenth of the saving, at least 8 tenths. */
export function goodDealHappiness(valueCents: number, priceCents: number): number {
  const saving = Math.max(GOOD_DEAL_FLOOR_CENTS, valueCents - priceCents);
  return HAPPINESS_PER_TENTH * Math.floor(saving / CENTS_PER_TENTH);
}

/** Completes the sale of the stall's `index`th item to the guest at `priceCents`. */
export function completeSale(
  world: World,
  slot: number,
  ride: number,
  index: number,
  priceCents: number,
  discounted: boolean,
): void {
  const g = world.guests.cols;
  const r = world.rides.cols;
  const item = stallItems(world, ride)[index];
  const def = shopItemDef(item);
  const price = Math.min(priceCents, g.cash[slot]);
  g.cash[slot] -= price;
  const foodOrDrink = def.kind !== 'souvenir';
  earn(world, foodOrDrink ? LedgerCategory.FoodDrinkSales : LedgerCategory.ShopSales, price);
  charge(
    world,
    foodOrDrink ? LedgerCategory.FoodDrinkStock : LedgerCategory.ShopStock,
    def.costCents,
  );
  addRideIncome(world, ride, price);
  if (index === 0) {
    r.itemSold0[ride]++;
    r.itemRevenue0[ride] += price;
  } else {
    r.itemSold1[ride]++;
    r.itemRevenue1[ride] += price;
  }
  r.guestsServed[ride]++;

  if (foodOrDrink) {
    const relief = consumptionRelief(item);
    g.hunger[slot] = addCapped(g.hunger[slot], relief.hunger);
    g.thirst[slot] = addCapped(g.thirst[slot], relief.thirst);
    g.toilet[slot] = addCapped(g.toilet[slot], relief.toilet);
    if (def.container !== 0) g.container[slot] = def.container;
  } else {
    giveSouvenir(world, slot, item);
  }

  const value = itemValueNow(world, item);
  if (!discounted && price <= value) {
    const growth = goodDealHappiness(value, price);
    g.happinessTarget[slot] = Math.min(MAX_NEED, g.happinessTarget[slot] + growth);
    g.happiness[slot] = Math.min(MAX_NEED, g.happiness[slot] + growth);
  }
}

function giveSouvenir(world: World, slot: number, item: ShopItem): void {
  const g = world.guests.cols;
  switch (item) {
    case ShopItem.Balloon:
      g.souvenirs[slot] |= Souvenir.Balloon;
      break;
    case ShopItem.Hat:
      g.souvenirs[slot] |= Souvenir.Hat;
      break;
    case ShopItem.TShirt:
      g.souvenirs[slot] |= Souvenir.TShirt;
      break;
    case ShopItem.Umbrella:
      world.umbrellas[world.guests.slotToId[slot]] = 1;
      break;
    case ShopItem.Map:
      g.hasMap[slot] = 1;
      g.lostTicks[slot] = 0;
      g.navGoal[slot] = 0;
      break;
  }
}
