import { describe, expect, it } from 'vitest';
import { BASIS_POINTS, NO_TARGET, createLedger } from './ledger';
import {
  CAMPAIGNS,
  MAX_CAMPAIGN_WEEKS,
  chargeCampaignWeek,
  marketingAttractionBps,
  startCampaign,
} from './marketing';

const FREE_RIDE = 2;
const FOOD_OFFER = 4;
const FREE_ENTRY = 0;

describe('campaign catalogue', () => {
  it('offers the six campaign families the manual lists', () => {
    expect(CAMPAIGNS).toHaveLength(6);
    expect(CAMPAIGNS.map((c) => c.target)).toEqual([
      'none',
      'none',
      'ride',
      'none',
      'item',
      'ride',
    ]);
  });

  it('runs for one to six weeks', () => {
    expect(MAX_CAMPAIGN_WEEKS).toBe(6);
    const l = createLedger();
    expect(startCampaign(l, FREE_ENTRY, 1)).toBe(true);
    expect(startCampaign(l, FREE_ENTRY, 6)).toBe(true);
    expect(startCampaign(l, FREE_ENTRY, 0)).toBe(false);
    expect(startCampaign(l, FREE_ENTRY, 7)).toBe(false);
  });

  it('rejects campaign ids outside the catalogue', () => {
    const l = createLedger();
    expect(startCampaign(l, CAMPAIGNS.length, 1)).toBe(false);
    expect(startCampaign(l, -1, 1)).toBe(false);
  });
});

describe('campaign targets', () => {
  it('requires a ride target for ride vouchers and rejects a missing or negative one', () => {
    const l = createLedger();
    expect(startCampaign(l, FREE_RIDE, 2)).toBe(false);
    expect(startCampaign(l, FREE_RIDE, 2, -5)).toBe(false);
    expect(startCampaign(l, FREE_RIDE, 2, 7)).toBe(true);
    expect(l.campaignTarget).toBe(7);
  });

  it('requires an item target for food and drink vouchers', () => {
    const l = createLedger();
    expect(startCampaign(l, FOOD_OFFER, 2)).toBe(false);
    expect(startCampaign(l, FOOD_OFFER, 2, 3)).toBe(true);
  });

  it('stores no target for park-wide campaigns', () => {
    const l = createLedger();
    expect(startCampaign(l, FREE_ENTRY, 2, 9)).toBe(true);
    expect(l.campaignTarget).toBe(NO_TARGET);
  });
});

describe('campaign costs and attraction', () => {
  it('charges its weekly price for each week and then stops', () => {
    const l = createLedger();
    startCampaign(l, FREE_ENTRY, 2);
    const cash = l.cash;
    chargeCampaignWeek(l);
    chargeCampaignWeek(l);
    chargeCampaignWeek(l);
    expect(l.cash).toBe(cash - 2 * CAMPAIGNS[FREE_ENTRY].weeklyCostCents);
    expect(l.campaignWeeksLeft).toBe(0);
  });

  it('boosts attraction only while the campaign has weeks left', () => {
    const l = createLedger();
    expect(marketingAttractionBps(l)).toBe(BASIS_POINTS);
    startCampaign(l, FREE_ENTRY, 1);
    expect(marketingAttractionBps(l)).toBe(CAMPAIGNS[FREE_ENTRY].attractionBps);
    chargeCampaignWeek(l);
    expect(marketingAttractionBps(l)).toBe(BASIS_POINTS);
  });
});
