import { describe, expect, it } from 'vitest';
import { RideType } from '../../sim/rides/ride-types';
import { RIDE_INFO_STRIDE, RideInfo } from '../../worker/snapshot';
import { stallItemRows } from './stall-items';

function info(values: Partial<Record<RideInfo, number>>): Int32Array {
  const data = new Int32Array(RIDE_INFO_STRIDE);
  for (const [key, value] of Object.entries(values)) data[Number(key)] = value!;
  return data;
}

describe('stallItemRows', () => {
  it('lists a burger stall as one item with sales and profit', () => {
    // 12 burgers at $1.50 = $18.00 taken; each costs 50c to stock, so profit is 1800 - 12 x 50
    const rows = stallItemRows(
      RideType.BurgerStall,
      info({
        [RideInfo.Price]: 150,
        [RideInfo.ItemSold0]: 12,
        [RideInfo.ItemRevenue0]: 1800,
      }),
      0,
      16,
    );
    expect(rows).toEqual([
      {
        name: 'Burger',
        priceCents: 150,
        valueCents: 190,
        costCents: 50,
        sold: 12,
        revenueCents: 1800,
        profitCents: 1200,
      },
    ]);
  });

  it('lists a kiosk as map and umbrella with their own prices and sales', () => {
    const rows = stallItemRows(
      RideType.InformationKiosk,
      info({
        [RideInfo.Price]: 60,
        [RideInfo.Price2]: 250,
        [RideInfo.ItemSold0]: 3,
        [RideInfo.ItemRevenue0]: 180,
        [RideInfo.ItemSold1]: 2,
        [RideInfo.ItemRevenue1]: 400,
      }),
      0,
      16,
    );
    expect(rows.map((row) => row.name)).toEqual(['Park Map', 'Umbrella']);
    expect(rows.map((row) => row.priceCents)).toEqual([60, 250]);
    // 3 maps cost 10c each; 2 umbrellas cost $2.00 each and were sold below cost
    expect(rows.map((row) => row.profitCents)).toEqual([150, 0]);
    expect(rows[1].valueCents).toBe(350);
  });

  it('shows what guests think the item is worth at the current temperature', () => {
    const drink = info({ [RideInfo.Price]: 120 });
    expect(stallItemRows(RideType.DrinkStall, drink, 0, 25)[0].valueCents).toBe(200);
    expect(stallItemRows(RideType.DrinkStall, drink, 0, 5)[0].valueCents).toBe(100);
  });

  it('is empty for rides and facilities that sell no items', () => {
    expect(stallItemRows(RideType.Toilets, info({}), 0, 16)).toEqual([]);
    expect(stallItemRows(RideType.MerryGoRound, info({}), 0, 16)).toEqual([]);
  });

  it('reads the row at the given offset', () => {
    const data = new Int32Array(RIDE_INFO_STRIDE * 2);
    data[RIDE_INFO_STRIDE + RideInfo.Price] = 90;
    expect(stallItemRows(RideType.IceCreamStall, data, RIDE_INFO_STRIDE, 16)[0].priceCents).toBe(
      90,
    );
  });
});
