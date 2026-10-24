import { borrow, repay } from './finance';
import { PriceMode } from './ledger';
import type { Ledger } from './ledger';
import { startCampaign } from './marketing';

export type EconomyAction =
  | { type: 'borrow'; cents: number }
  | { type: 'repay'; cents: number }
  | { type: 'setPriceMode'; mode: PriceMode }
  | { type: 'setAdmissionPrice'; cents: number }
  | { type: 'startCampaign'; campaignId: number; weeks: number };

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
      return startCampaign(l, action.campaignId, action.weeks);
  }
}
