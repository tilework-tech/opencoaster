import { isShopCategory } from '../../sim/rides/ride-operations';
import { RESTRICTION_REFUSALS } from '../../sim/scenario/restrictions';
import { RIDE_CATALOG } from '../../sim/rides/ride-types';
import type { RideType } from '../../sim/rides/ride-types';
import { EconomyResult } from '../../sim/economy/actions';
import { RideInfo, RIDE_INFO_STRIDE } from '../../worker/snapshot';

const ECONOMY_MESSAGES: Record<EconomyResult, string> = {
  [EconomyResult.Ok]: '',
  [EconomyResult.Rejected]: 'That change was not allowed.',
  [EconomyResult.BadCampaign]: 'That campaign does not exist.',
  [EconomyResult.BadDuration]: 'Choose a campaign length from 1 to 6 weeks.',
  [EconomyResult.MissingTarget]: 'Choose a ride or stall for this campaign first.',
  [EconomyResult.NoSuchRide]: 'That ride no longer exists. Choose another.',
  [EconomyResult.NotARide]: 'Shops and facilities cannot be promoted as rides. Choose a ride.',
  [EconomyResult.NotAFoodOrDrinkStall]: 'Choose a food or drink stall for this offer.',
  [EconomyResult.MarketingForbidden]: RESTRICTION_REFUSALS.marketing,
};

/** Player-facing text for the outcome of the latest economy command. */
export function economyFeedbackMessage(code: number): string {
  return ECONOMY_MESSAGES[code as EconomyResult] ?? `Economy result ${code}`;
}

export interface TargetOption {
  id: number;
  name: string;
}

export function isPromotableRide(type: RideType): boolean {
  const def = RIDE_CATALOG[type];
  return def !== undefined && !isShopCategory(def.category);
}

export function isFoodOrDrinkStall(type: RideType): boolean {
  return RIDE_CATALOG[type]?.serves !== undefined;
}

/** The rides in a snapshot roster, as `RideInfo` rows, filtered by an eligibility rule. */
export function targetOptions(
  snapshot: { rides: { count: number }; rideInfo: Int32Array },
  eligible: (type: RideType) => boolean,
): TargetOption[] {
  const options: TargetOption[] = [];
  for (let i = 0; i < snapshot.rides.count; i++) {
    const o = i * RIDE_INFO_STRIDE;
    const id = snapshot.rideInfo[o + RideInfo.Id];
    const type = snapshot.rideInfo[o + RideInfo.Type] as RideType;
    if (eligible(type)) options.push({ id, name: `${RIDE_CATALOG[type].name} ${id + 1}` });
  }
  return options;
}
