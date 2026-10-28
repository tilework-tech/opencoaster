import { LedgerCategory, NO_CAMPAIGN, NO_TARGET, post } from './ledger';
import type { Ledger } from './ledger';
import { VoucherKind } from './vouchers';

/** What a campaign points guests at: the whole park, one ride, or one food or drink item. */
export type CampaignTarget = 'none' | 'ride' | 'item';

export interface CampaignDef {
  name: string;
  target: CampaignTarget;
  weeklyCostCents: number;
  /** Chance per tick, out of 65536, that the running campaign draws an extra guest. */
  guestsPerTick: number;
  /** What each guest the campaign attracts carries. */
  voucher: VoucherKind;
}

/**
 * The six RCT2 campaign families, in manual order; the index is the campaign id. Weekly prices
 * are tunable: the manual transcriptions disagree on prices and no controlled RCT2 comparison
 * exists yet (economy.md, Marketing; DECISIONS.md). Each campaign draws extra guests at its own
 * per-tick chance, in the original game's proportions (free entry 400, free rides 300, park
 * advertising 250, half-price entry, free food and ride advertising 200).
 */
export const CAMPAIGNS: readonly CampaignDef[] = [
  {
    name: 'Free park-entry vouchers',
    target: 'none',
    weeklyCostCents: 5_000,
    guestsPerTick: 400,
    voucher: VoucherKind.FreeEntry,
  },
  {
    name: 'Park advertising',
    target: 'none',
    weeklyCostCents: 35_000,
    guestsPerTick: 250,
    voucher: VoucherKind.None,
  },
  {
    name: 'Free ride vouchers',
    target: 'ride',
    weeklyCostCents: 5_000,
    guestsPerTick: 300,
    voucher: VoucherKind.FreeRide,
  },
  {
    name: 'Half-price park-entry vouchers',
    target: 'none',
    weeklyCostCents: 5_000,
    guestsPerTick: 200,
    voucher: VoucherKind.HalfPriceEntry,
  },
  {
    name: 'Free food or drink vouchers',
    target: 'item',
    weeklyCostCents: 5_000,
    guestsPerTick: 200,
    voucher: VoucherKind.FreeFoodOrDrink,
  },
  {
    name: 'Selected-ride advertising',
    target: 'ride',
    weeklyCostCents: 20_000,
    guestsPerTick: 200,
    voucher: VoucherKind.None,
  },
];

export const MIN_CAMPAIGN_WEEKS = 1;
export const MAX_CAMPAIGN_WEEKS = 6;

/**
 * Starts a campaign, replacing any running one. Targeted campaigns need a non-negative target
 * id; park-wide campaigns store none. Whether the target ride or item exists is checked by the
 * caller, which owns those tables.
 */
export function startCampaign(
  l: Ledger,
  campaignId: number,
  weeks: number,
  targetId: number = NO_TARGET,
): boolean {
  if (!Number.isInteger(campaignId) || campaignId < 0 || campaignId >= CAMPAIGNS.length) {
    return false;
  }
  if (!Number.isInteger(weeks) || weeks < MIN_CAMPAIGN_WEEKS || weeks > MAX_CAMPAIGN_WEEKS) {
    return false;
  }
  const def = CAMPAIGNS[campaignId];
  if (def.target === 'none') {
    l.campaignTarget = NO_TARGET;
  } else {
    if (!Number.isSafeInteger(targetId) || targetId < 0) return false;
    l.campaignTarget = targetId;
  }
  l.campaignId = campaignId;
  l.campaignWeeksLeft = weeks;
  return true;
}

/** Ride the campaign attracts guests toward, or NO_TARGET for a park-wide campaign. */
export function marketingRideTarget(l: Ledger): number {
  if (l.campaignWeeksLeft <= 0 || l.campaignId === NO_CAMPAIGN) return NO_TARGET;
  return CAMPAIGNS[l.campaignId].target === 'ride' ? l.campaignTarget : NO_TARGET;
}

/** The voucher a guest arriving now receives, and the ride or stall it names (NO_TARGET if none). */
export function marketingVoucher(l: Ledger): { kind: VoucherKind; target: number } {
  if (l.campaignWeeksLeft <= 0 || l.campaignId === NO_CAMPAIGN) {
    return { kind: VoucherKind.None, target: NO_TARGET };
  }
  return { kind: CAMPAIGNS[l.campaignId].voucher, target: l.campaignTarget };
}

/** Called once per week: pays for the running campaign and consumes one of its weeks. */
export function chargeCampaignWeek(l: Ledger): void {
  if (l.campaignWeeksLeft <= 0 || l.campaignId === NO_CAMPAIGN) return;
  post(l, LedgerCategory.Marketing, -CAMPAIGNS[l.campaignId].weeklyCostCents);
  l.campaignWeeksLeft--;
}
