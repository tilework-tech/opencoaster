import type { World } from '../core/world';
import { PriceMode, post } from './ledger';
import type { EconomyInputs, LedgerCategory } from './ledger';
import { marketingAttractionBps as attractionBps } from './marketing';

function assertAmount(cents: number): void {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(`money amount must be a non-negative integer, got ${cents}`);
  }
}

/** Money received: cash up, category total up. Amounts are non-negative. */
export function earn(world: World, category: LedgerCategory, cents: number): void {
  assertAmount(cents);
  post(world.economy, category, cents);
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

/** Guest attraction multiplier in basis points (10000 = no campaign). */
export function marketingAttraction(world: World): number {
  return attractionBps(world.economy);
}
