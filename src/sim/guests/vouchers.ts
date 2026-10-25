import type { World } from '../core/world';
import { VoucherKind } from '../economy/vouchers';

/** Whether the guest holds a voucher of `kind` that names ride or stall `rideId`. */
export function carriesVoucherFor(
  world: World,
  slot: number,
  rideId: number,
  kind: VoucherKind,
): boolean {
  const g = world.guests.cols;
  return g.voucherKind[slot] === kind && g.voucherTarget[slot] === rideId;
}

/** Uses up the guest's voucher for `rideId` if it is of `kind`; returns whether it was used. */
export function spendVoucher(
  world: World,
  slot: number,
  rideId: number,
  kind: VoucherKind,
): boolean {
  if (!carriesVoucherFor(world, slot, rideId, kind)) return false;
  const g = world.guests.cols;
  g.voucherKind[slot] = VoucherKind.None;
  g.voucherTarget[slot] = -1;
  return true;
}

/** What the guest pays for `rideId` at `priceCents`: nothing while a matching voucher is held. */
export function guestPriceCents(
  world: World,
  slot: number,
  rideId: number,
  priceCents: number,
  kind: VoucherKind,
): number {
  return carriesVoucherFor(world, slot, rideId, kind) ? 0 : priceCents;
}
