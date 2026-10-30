import { RIDE_CATALOG } from '../../sim/rides/ride-types';
import type { RideType } from '../../sim/rides/ride-types';
import { itemValueAtTemperature, shopItemDef } from '../../sim/rides/shop-items';
import { RideInfo } from '../../worker/snapshot';

export interface StallItemRow {
  name: string;
  priceCents: number;
  /** What guests think the item is worth at today's temperature. */
  valueCents: number;
  costCents: number;
  sold: number;
  revenueCents: number;
  /** Takings less the stock cost of every item sold. */
  profitCents: number;
}

/** One row per item the stall sells, read from the ride-info record starting at `offset`. */
export function stallItemRows(
  type: RideType,
  info: Int32Array,
  offset: number,
  temperature: number,
): StallItemRow[] {
  const items = RIDE_CATALOG[type]?.items ?? [];
  return items.map((item, index) => {
    const def = shopItemDef(item);
    const sold = info[offset + (index === 0 ? RideInfo.ItemSold0 : RideInfo.ItemSold1)];
    const revenueCents =
      info[offset + (index === 0 ? RideInfo.ItemRevenue0 : RideInfo.ItemRevenue1)];
    return {
      name: def.name,
      priceCents: info[offset + (index === 0 ? RideInfo.Price : RideInfo.Price2)],
      valueCents: itemValueAtTemperature(item, temperature),
      costCents: def.costCents,
      sold,
      revenueCents,
      profitCents: revenueCents - sold * def.costCents,
    };
  });
}
