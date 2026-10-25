import { describe, expect, it } from 'vitest';
import { VoucherKind } from '../../sim/economy/vouchers';
import { filterGuestSummary, orderedHistory, voucherText } from './guest-window';

describe('guest vouchers', () => {
  it('names the ride or stall a carried voucher is for', () => {
    expect(voucherText(VoucherKind.FreeRide, 'Merry-Go-Round #3')).toBe(
      'Voucher: free ride on Merry-Go-Round #3',
    );
    expect(voucherText(VoucherKind.FreeFoodOrDrink, 'Burger Stall #7')).toBe(
      'Voucher: free food or drink at Burger Stall #7',
    );
  });

  it('says so when the guest carries no voucher', () => {
    expect(voucherText(VoucherKind.None, 'nothing')).toBe('Carrying no vouchers.');
  });
});

describe('guest summary filters', () => {
  const guests = [
    { id: 4, thought: 2, tileX: 7, tileY: 3, rideIds: [11, 0, 0, 0] },
    { id: 8, thought: 6, tileX: 7, tileY: 3, rideIds: [12, 11, 0, 0] },
    { id: 9, thought: 2, tileX: 1, tileY: 2, rideIds: [12, 0, 0, 0] },
  ];

  it('filters guests by their latest thought', () => {
    expect(filterGuestSummary(guests, { kind: 'thought', value: 2 }).map((g) => g.id)).toEqual([
      4, 9,
    ]);
  });

  it('filters guests by tile location', () => {
    expect(filterGuestSummary(guests, { kind: 'location', x: 7, y: 3 }).map((g) => g.id)).toEqual([
      4, 8,
    ]);
  });

  it('filters guests by any ride in their recent ride history', () => {
    expect(filterGuestSummary(guests, { kind: 'ride', value: 11 }).map((g) => g.id)).toEqual([
      4, 8,
    ]);
  });

  it('does not list missing guest ids', () => {
    expect(
      filterGuestSummary(
        [
          { id: 0, thought: 2, tileX: 7, tileY: 3, rideIds: [] },
          { id: 3, thought: 2, tileX: 7, tileY: 3, rideIds: [] },
        ],
        { kind: 'all' },
      ).map((g) => g.id),
    ).toEqual([3]);
  });
});

describe('guest history ordering', () => {
  it('returns nonempty ring entries newest first across cursor wraparound', () => {
    expect(orderedHistory(1, [5, 6, 7, 8])).toEqual([5, 8, 7, 6]);
  });

  it('returns no entries from an empty ring', () => {
    expect(orderedHistory(0, [0, 0, 0, 0])).toEqual([]);
  });
});
