/** What a campaign's voucher entitles a guest to. Zero means the guest carries nothing. */
export const enum VoucherKind {
  None = 0,
  FreeEntry = 1,
  HalfPriceEntry = 2,
  FreeRide = 3,
  FreeFoodOrDrink = 4,
}

/** Entry vouchers are used up at the gate; the others wait for the targeted ride or stall. */
export function isEntryVoucher(kind: VoucherKind): boolean {
  return kind === VoucherKind.FreeEntry || kind === VoucherKind.HalfPriceEntry;
}

/** Gate fee a voucher leaves to pay, in cents. */
export function gateFeeAfterVoucher(kind: VoucherKind, feeCents: number): number {
  if (kind === VoucherKind.FreeEntry) return 0;
  if (kind === VoucherKind.HalfPriceEntry) return Math.floor(feeCents / 2);
  return feeCents;
}
