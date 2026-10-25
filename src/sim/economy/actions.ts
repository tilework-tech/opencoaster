import type { World } from '../core/world';
import { getRideType, isShopCategory } from '../rides/ride-operations';
import { RIDE_CATALOG, RideType } from '../rides/ride-types';
import { borrow, repay } from './finance';
import { PriceMode } from './ledger';
import type { Ledger } from './ledger';
import { CAMPAIGNS, MAX_CAMPAIGN_WEEKS, MIN_CAMPAIGN_WEEKS, startCampaign } from './marketing';

export type EconomyAction =
  | { type: 'borrow'; cents: number }
  | { type: 'repay'; cents: number }
  | { type: 'setPriceMode'; mode: PriceMode }
  | { type: 'setAdmissionPrice'; cents: number }
  | { type: 'startCampaign'; campaignId: number; weeks: number; targetId?: number };

/** Outcome of an economy command, published to the UI as `FeedbackDomain.Economy`. */
export const enum EconomyResult {
  Ok = 0,
  Rejected = 1,
  BadCampaign = 2,
  BadDuration = 3,
  MissingTarget = 4,
  NoSuchRide = 5,
  NotARide = 6,
  NotAFoodOrDrinkStall = 7,
}

/** Returns false when the action is rejected; rejected actions leave state untouched. */
export function applyEconomyAction(l: Ledger, action: EconomyAction): boolean {
  switch (action.type) {
    case 'borrow':
      return borrow(l, action.cents);
    case 'repay':
      return repay(l, action.cents);
    case 'setPriceMode':
      l.priceMode = action.mode;
      return true;
    case 'setAdmissionPrice':
      if (l.priceMode !== PriceMode.Admission) return false;
      if (!Number.isSafeInteger(action.cents) || action.cents < 0) return false;
      l.admissionPrice = action.cents;
      return true;
    case 'startCampaign':
      return startCampaign(l, action.campaignId, action.weeks, action.targetId);
  }
}

/**
 * Applies an economy command with the park's rides in view, so campaign targets are checked
 * against the rides that exist. Rejected commands leave state untouched.
 */
export function applyEconomyCommand(world: World, action: EconomyAction): EconomyResult {
  if (action.type !== 'startCampaign') {
    return applyEconomyAction(world.economy, action) ? EconomyResult.Ok : EconomyResult.Rejected;
  }
  return startCampaignCommand(world, action);
}

function startCampaignCommand(
  world: World,
  action: Extract<EconomyAction, { type: 'startCampaign' }>,
): EconomyResult {
  const def = CAMPAIGNS[action.campaignId];
  if (!def) return EconomyResult.BadCampaign;
  if (
    !Number.isInteger(action.weeks) ||
    action.weeks < MIN_CAMPAIGN_WEEKS ||
    action.weeks > MAX_CAMPAIGN_WEEKS
  ) {
    return EconomyResult.BadDuration;
  }
  if (def.target === 'none') {
    return applyEconomyAction(world.economy, action) ? EconomyResult.Ok : EconomyResult.Rejected;
  }
  if (action.targetId === undefined) return EconomyResult.MissingTarget;

  const type = getRideType(world, action.targetId);
  if (type === undefined) return EconomyResult.NoSuchRide;
  if (def.target === 'ride' && isShopCategory(RIDE_CATALOG[type].category)) {
    return EconomyResult.NotARide;
  }
  if (def.target === 'item' && type !== RideType.FoodStall && type !== RideType.DrinkStall) {
    return EconomyResult.NotAFoodOrDrinkStall;
  }
  return applyEconomyAction(world.economy, action) ? EconomyResult.Ok : EconomyResult.Rejected;
}
