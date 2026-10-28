import { describe, expect, it } from 'vitest';
import { VoucherKind } from '../../sim/economy/vouchers';
import {
  energyFraction,
  filterGuestSummary,
  guestDetailsText,
  orderedHistory,
  voucherText,
} from './guest-window';

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
    { id: 10, thought: 13, tileX: 1, tileY: 2, rideIds: [] },
  ];

  it('filters guests by their latest thought', () => {
    expect(filterGuestSummary(guests, { kind: 'thought', value: 2 }).map((g) => g.id)).toEqual([
      4, 9,
    ]);
  });

  it('filters guests by the new RCT2 need thoughts', () => {
    expect(filterGuestSummary(guests, { kind: 'thought', value: 13 }).map((g) => g.id)).toEqual([
      10,
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

describe('guest thoughts', () => {
  it('shows tired and low-cash thoughts in an individual guest detail view', () => {
    const text = guestDetailsText({
      happiness: 82,
      hunger: 12,
      thirst: 25,
      toilet: 160,
      nausea: 0,
      energy: 65,
      cash: 800,
      thoughts: [13, 14],
    });

    expect(text).toContain("I'm tired");
    expect(text).toContain("I'm running out of money");
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

describe('energy bar', () => {
  it('spans the 32..128 energy range, empty at the minimum and full at the maximum', () => {
    expect(energyFraction(32)).toBe(0);
    expect(energyFraction(80)).toBe(0.5);
    expect(energyFraction(128)).toBe(1);
    expect(energyFraction(255)).toBe(1);
    expect(energyFraction(0)).toBe(0);
  });
});
