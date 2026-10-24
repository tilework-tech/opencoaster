import { BASIS_POINTS, LedgerCategory, NO_CAMPAIGN, post } from './ledger';
import type { Ledger } from './ledger';

export interface CampaignDef {
  name: string;
  weeklyCostCents: number;
  /** Guest attraction multiplier while the campaign runs, in basis points. */
  attractionBps: number;
}

/**
 * Placeholder campaign table. The RCT2 manual transcriptions disagree on prices (economy.md,
 * Marketing), so these values are tunable hypotheses, not verified constants.
 */
export const CAMPAIGNS: readonly CampaignDef[] = [
  { name: 'free-entry vouchers', weeklyCostCents: 5_000, attractionBps: 12_000 },
  { name: 'park advertising', weeklyCostCents: 15_000, attractionBps: 13_500 },
];

export const MAX_CAMPAIGN_WEEKS = 8;

export function startCampaign(l: Ledger, campaignId: number, weeks: number): boolean {
  if (!Number.isInteger(campaignId) || campaignId < 0 || campaignId >= CAMPAIGNS.length) {
    return false;
  }
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_CAMPAIGN_WEEKS) return false;
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
