import { describe, expect, it } from 'vitest';
import { createLedger } from './ledger';
import { applyEconomyAction } from './actions';
import { PriceMode } from './ledger';
import { LOAN_STEP_CENTS } from './finance';

describe('economy actions', () => {
  it('only accepts an admission price while the gate is the active price mode', () => {
    const l = createLedger();
    expect(applyEconomyAction(l, { type: 'setAdmissionPrice', cents: 500 })).toBe(false);
    expect(applyEconomyAction(l, { type: 'setPriceMode', mode: PriceMode.Admission })).toBe(true);
    expect(applyEconomyAction(l, { type: 'setAdmissionPrice', cents: 500 })).toBe(true);
    expect(l.admissionPrice).toBe(500);
  });

  it('rejects loans that are not in whole $1,000 steps', () => {
    const l = createLedger();
    l.maxLoan = 5 * LOAN_STEP_CENTS;
    expect(applyEconomyAction(l, { type: 'borrow', cents: 150 })).toBe(false);
    expect(applyEconomyAction(l, { type: 'borrow', cents: LOAN_STEP_CENTS })).toBe(true);
  });

  it('rejects campaigns with unknown ids or non-positive durations', () => {
    const l = createLedger();
    expect(applyEconomyAction(l, { type: 'startCampaign', campaignId: 99, weeks: 1 })).toBe(false);
    expect(applyEconomyAction(l, { type: 'startCampaign', campaignId: 0, weeks: 0 })).toBe(false);
  });
});
