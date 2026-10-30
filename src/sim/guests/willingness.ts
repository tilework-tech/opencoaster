import type { World } from '../core/world';
import { getRideValueCents } from '../rides/ride-operations';
import { RIDE_CATALOG } from '../rides/ride-types';
import type { RideType } from '../rides/ride-types';
import { itemValueAtTemperature } from '../rides/shop-items';

/**
 * Guests pay up to twice a ride's value for a ticket (the same threshold the ride window calls
 * "too expensive"), and at least this much for any ride however little it is worth.
 */
export const RIDE_PRICE_FLOOR_CENTS = 600;
/** A guest happier than this halves how overpriced an item looks, and again above the next. */
export const CONTENT_HAPPINESS = 128;
export const DELIGHTED_HAPPINESS = 180;
/** The random tolerance a guest rolls at a stall is 0 to 7 tenths of a currency unit. */
export const ITEM_TOLERANCE_ROLLS = 8;
export const ITEM_TOLERANCE_STEP_CENTS = 10;

export function maxRidePriceCents(world: World, rideSlot: number): number {
  const value = getRideValueCents(world, world.rides.slotToId[rideSlot]);
  return Math.max(RIDE_PRICE_FLOOR_CENTS, 2 * value);
}

/** What a stall's `itemIndex`th item is worth to guests at today's temperature, or its starting price when it sells no item. */
export function itemValueCents(world: World, rideSlot: number, itemIndex = 0): number {
  const def = RIDE_CATALOG[world.rides.cols.typeId[rideSlot] as RideType];
  const item = def.items?.[itemIndex];
  return item === undefined
    ? def.defaultPriceCents
    : itemValueAtTemperature(item, world.weather.temperature);
}

function overpriceDivisor(happiness: number): number {
  return happiness > DELIGHTED_HAPPINESS ? 4 : happiness > CONTENT_HAPPINESS ? 2 : 1;
}

/** Whether a guest with this happiness accepts `priceCents` after rolling `roll` (0 to 7). */
export function acceptsItemPrice(
  priceCents: number,
  valueCents: number,
  happiness: number,
  roll: number,
): boolean {
  const overprice = Math.max(0, priceCents - valueCents);
  return Math.floor(overprice / overpriceDivisor(happiness)) <= roll * ITEM_TOLERANCE_STEP_CENTS;
}

/** The highest price this guest could ever accept, however well they roll. */
export function maxItemPriceCents(
  world: World,
  rideSlot: number,
  happiness: number,
  itemIndex = 0,
): number {
  return (
    itemValueCents(world, rideSlot, itemIndex) +
    (ITEM_TOLERANCE_ROLLS - 1) * ITEM_TOLERANCE_STEP_CENTS * overpriceDivisor(happiness) +
    (overpriceDivisor(happiness) - 1)
  );
}

export function priceIsAcceptable(priceCents: number, limitCents: number): boolean {
  return priceCents <= limitCents;
}
