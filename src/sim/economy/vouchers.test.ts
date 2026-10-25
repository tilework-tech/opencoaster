import { describe, expect, it } from 'vitest';
import { createLedger, NO_TARGET } from './ledger';
import { CAMPAIGNS, marketingVoucher } from './marketing';
import { gateFeeAfterVoucher, VoucherKind } from './vouchers';

describe('gate fees under a voucher', () => {
  it('waives the fee for a free park-entry voucher', () => {
    expect(gateFeeAfterVoucher(VoucherKind.FreeEntry, 1_999)).toBe(0);
  });

  it('rounds a half-price fee down to whole cents', () => {
    expect(gateFeeAfterVoucher(VoucherKind.HalfPriceEntry, 1_999)).toBe(999);
  });

  it('leaves the fee alone when no entry voucher applies', () => {
    expect(gateFeeAfterVoucher(VoucherKind.None, 1_999)).toBe(1_999);
    expect(gateFeeAfterVoucher(VoucherKind.FreeRide, 1_999)).toBe(1_999);
  });
});

describe('campaign vouchers', () => {
  it('gives guests the voucher of the running campaign and the target it names', () => {
    const ledger = createLedger();
    ledger.campaignId = 2;
    ledger.campaignWeeksLeft = 3;
    ledger.campaignTarget = 5;
    expect(marketingVoucher(ledger)).toEqual({ kind: VoucherKind.FreeRide, target: 5 });
  });

  it('gives no voucher once the campaign has run out or never started', () => {
    const ledger = createLedger();
    expect(marketingVoucher(ledger)).toEqual({ kind: VoucherKind.None, target: NO_TARGET });
    ledger.campaignId = 0;
    ledger.campaignWeeksLeft = 0;
    expect(marketingVoucher(ledger)).toEqual({ kind: VoucherKind.None, target: NO_TARGET });
  });

  it('issues no voucher from the advertising campaigns', () => {
    const advertising = CAMPAIGNS.flatMap((campaign, id) =>
      campaign.voucher === VoucherKind.None ? [id] : [],
    );
    expect(advertising).toEqual([1, 5]);
  });
});
