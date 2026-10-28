import type { World } from '../core/world';
import { PriceMode, post } from './ledger';
import { LedgerCategory } from './ledger';
import type { EconomyInputs } from './ledger';
import type { VoucherKind } from './vouchers';
import { marketingRideTarget as rideTarget, marketingVoucher } from './marketing';

function assertAmount(cents: number): void {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`money amount must be a non-negative integer, got ${cents}`);
  }
}

/** Money received: cash up, category total up. Amounts are non-negative. */
export function earn(world: World, category: LedgerCategory, cents: number): void {
  assertAmount(cents);
  post(world.economy, category, cents);
  if (
    cents > 0 &&
    (category === LedgerCategory.Admission ||
      category === LedgerCategory.RideTickets ||
      category === LedgerCategory.ShopSales ||
      category === LedgerCategory.FoodDrinkSales) &&
    world.audioRegisterTick !== world.tick
  ) {
    world.audioRegisterTick = world.tick;
    world.audioEvents.push({ id: ++world.audioEventSequence, type: 'register' });
  }
}

/** Money spent: cash down, category total down. Cash may go negative. */
export function charge(world: World, category: LedgerCategory, cents: number): void {
  assertAmount(cents);
  post(world.economy, category, -cents);
}

/** Systems publish their current figures here; the economy reads them on its own schedule. */
export function setEconomyInputs(world: World, patch: Partial<EconomyInputs>): void {
  Object.assign(world.economy.inputs, patch);
}

/** Entrance fee guests pay on arrival. Zero unless the scenario uses admission pricing. */
export function gateAdmissionCents(world: World): number {
  return world.economy.priceMode === PriceMode.Admission ? world.economy.admissionPrice : 0;
}

/** Whether rides may charge guests per ride. */
export function ridePricingEnabled(world: World): boolean {
  return world.economy.priceMode === PriceMode.PerRide;
}

/** Voucher the next arriving guest receives, with the ride or stall it names. */
export function arrivalVoucher(world: World): { kind: VoucherKind; target: number } {
  return marketingVoucher(world.economy);
}

/** Ride new arrivals are drawn toward by an active ride offer or advertising campaign. */
export function marketingTargetRide(world: World): number {
  return rideTarget(world.economy);
}

export function recordDrowningCasualty(world: World): void {
  world.economy.inputs.drowningCasualties++;
  world.economy.inputs.drowningCasualtyPenalty += 25;
}

export function recordFatalRideCrash(world: World): void {
  world.economy.inputs.fatalRideCrashes++;
  world.economy.inputs.fatalRideCrashPenalty += 200;
}
