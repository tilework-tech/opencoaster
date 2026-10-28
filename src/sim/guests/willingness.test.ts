import { describe, expect, it } from 'vitest';
import { flatWorld, layPath, openRide, row } from '../integration/fixtures';
import { RideType } from '../rides/ride-types';
import { getRideValueCents } from '../rides/ride-operations';
import {
  RIDE_PRICE_FLOOR_CENTS,
  acceptsItemPrice,
  itemValueCents,
  maxItemPriceCents,
  maxRidePriceCents,
  priceIsAcceptable,
} from './willingness';

function parkWith(type: RideType) {
  const w = flatWorld();
  layPath(w, row(5, 2, 9));
  layPath(w, row(5, 10, 11), true);
  layPath(w, [[12, 4]]);
  const slot =
    type === RideType.MerryGoRound
      ? openRide(
          w,
          type,
          [11, 4],
          [11, 5],
          [12, 4],
          [
            [10, 5],
            [9, 5],
          ],
        )
      : openRide(w, type, [9, 3], [9, 4], [10, 3]);
  return { w, slot };
}

describe('price willingness limits', () => {
  it('lets a ride charge twice its value, and never less than the floor', () => {
    const { w, slot } = parkWith(RideType.MerryGoRound);
    const value = getRideValueCents(w, w.rides.slotToId[slot]);
    expect(maxRidePriceCents(w, slot)).toBe(Math.max(RIDE_PRICE_FLOOR_CENTS, 2 * value));
    w.rides.cols.excitement[slot] = 0;
    w.rides.cols.intensity[slot] = 0;
    w.rides.cols.nausea[slot] = 0;
    expect(maxRidePriceCents(w, slot)).toBe(RIDE_PRICE_FLOOR_CENTS);
  });

  it('values a stall item at its catalog base price', () => {
    const { w, slot } = parkWith(RideType.DrinkStall);
    expect(itemValueCents(w, slot)).toBe(120);
  });

  it('accepts any price up to the item value whatever the roll', () => {
    expect(acceptsItemPrice(120, 120, 0, 0)).toBe(true);
    expect(acceptsItemPrice(60, 120, 0, 0)).toBe(true);
  });

  it('lets a guest in a bad mood overpay by the rolled tenths only', () => {
    expect(acceptsItemPrice(150, 120, 100, 3)).toBe(true);
    expect(acceptsItemPrice(151, 120, 100, 3)).toBe(false);
  });

  it('halves the overprice for a content guest and quarters it for a delighted one', () => {
    expect(acceptsItemPrice(222, 120, 129, 5)).toBe(false);
    expect(acceptsItemPrice(170, 120, 129, 5)).toBe(true);
    expect(acceptsItemPrice(120 + 204, 120, 181, 5)).toBe(false);
    expect(acceptsItemPrice(120 + 204, 120, 181, 7)).toBe(true);
  });

  it('bounds the price a guest could ever accept by happiness', () => {
    const { w, slot } = parkWith(RideType.DrinkStall);
    expect(maxItemPriceCents(w, slot, 100)).toBe(190);
    expect(maxItemPriceCents(w, slot, 150)).toBe(120 + 141);
    expect(maxItemPriceCents(w, slot, 255)).toBe(120 + 283);
    expect(acceptsItemPrice(120 + 283, 120, 255, 7)).toBe(true);
    expect(acceptsItemPrice(120 + 284, 120, 255, 7)).toBe(false);
  });

  it('accepts free tickets and prices at the limit, rejects anything above', () => {
    expect(priceIsAcceptable(0, 160)).toBe(true);
    expect(priceIsAcceptable(160, 160)).toBe(true);
    expect(priceIsAcceptable(161, 160)).toBe(false);
  });
});
