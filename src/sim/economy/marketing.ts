import { BASIS_POINTS, LedgerCategory, NO_CAMPAIGN, NO_TARGET, post } from './ledger';
import type { Ledger } from './ledger';

/** What a campaign points guests at: the whole park, one ride, or one food or drink item. */
export type CampaignTarget = 'none' | 'ride' | 'item';

export interface CampaignDef {
  name: string;
  target: CampaignTarget;
  weeklyCostCents: number;
  /** Guest attraction multiplier while the campaign runs, in basis points. */
  attractionBps: number;
}

/**
 * The six RCT2 campaign families, in manual order; the index is the campaign id. Weekly prices
 * and attraction multipliers are tunable: the manual transcriptions disagree on prices and no
 * controlled RCT2 comparison exists yet (economy.md, Marketing; DECISIONS.md). The two
 * advertising ids keep their original values so existing saves and callers stay valid.
 */
export const CAMPAIGNS: readonly CampaignDef[] = [
  {
    name: 'free park-entry vouchers',
    target: 'none',
    weeklyCostCents: 5_000,
    attractionBps: 12_000,
  },
  { name: 'park advertising', target: 'none', weeklyCostCents: 15_000, attractionBps: 13_500 },
  { name: 'free ride vouchers', target: 'ride', weeklyCostCents: 7_500, attractionBps: 11_500 },
  {
    name: 'half-price park-entry vouchers',
    target: 'none',
    weeklyCostCents: 6_000,
    attractionBps: 12_000,
  },
  {
    name: 'free food or drink vouchers',
    target: 'item',
    weeklyCostCents: 4_000,
    attractionBps: 11_000,
  },
  {
    name: 'selected-ride advertising',
    target: 'ride',
    weeklyCostCents: 8_000,
    attractionBps: 11_000,
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

export function marketingAttractionBps(l: Ledger): number {
  if (l.campaignWeeksLeft <= 0 || l.campaignId === NO_CAMPAIGN) return BASIS_POINTS;
  return CAMPAIGNS[l.campaignId].attractionBps;
}

/** Called once per week: pays for the running campaign and consumes one of its weeks. */
export function chargeCampaignWeek(l: Ledger): void {
  if (l.campaignWeeksLeft <= 0 || l.campaignId === NO_CAMPAIGN) return;
  post(l, LedgerCategory.Marketing, -CAMPAIGNS[l.campaignId].weeklyCostCents);
  l.campaignWeeksLeft--;
}
