import type { World } from '../core/world';
import { RIDE_BONUS_VALUE } from '../rides/ride-bonus-value';
import { getRideValueCents, isShopCategory } from '../rides/ride-operations';
import { RideState } from '../rides/ride-store';
import { RIDE_CATALOG, type RideType } from '../rides/ride-types';
import { gateAdmissionCents, ridePricingEnabled } from './api';
import { AWARDS } from './awards';
import { CAMPAIGNS } from './marketing';
import { VoucherKind } from './vouchers';
import { NO_CAMPAIGN } from './ledger';
import type { ActiveAward, GuestGeneration } from './ledger';

/** Guest generation rolls against this many outcomes every tick. */
export const GENERATION_ROLL_RANGE = 65_536;
const BASE_PROBABILITY = 50;
const RATING_FLOOR = 200;
const RATING_SPAN = 650;
/** Beyond this many guests in the park, arrivals are cut again. */
const HARD_GUEST_LIMIT = 52_000;
const MAX_SUGGESTED_GUESTS = 65_535;
/** Entry-fee thresholds under which a free or half-price entry campaign draws few extra guests. */
const FREE_ENTRY_FEE_FLOOR_CENTS = 400;
const HALF_PRICE_ENTRY_FEE_FLOOR_CENTS = 600;
const FREE_RIDE_PRICE_FLOOR_CENTS = 30;

export interface GenerationFactors {
  parkRating: number;
  /** Guests in the park. */
  guests: number;
  suggestedGuestMax: number;
  entranceFeeCents: number;
  rideValueForMoney: number;
  awards: readonly ActiveAward[];
  tick: number;
}

/**
 * Chance, out of `GENERATION_ROLL_RANGE`, that a guest arrives on a given tick: 50 plus the rating
 * above 200 (at most 650), quartered while the park is over its suggested maximum, quartered
 * again for an entrance fee above the total value of open rides (and again above twice it), then
 * raised or lowered by a quarter for each current award.
 */
export function guestGenerationProbability(f: GenerationFactors): number {
  let probability =
    BASE_PROBABILITY + Math.min(RATING_SPAN, Math.max(0, f.parkRating - RATING_FLOOR));
  if (f.guests > f.suggestedGuestMax) probability = Math.trunc(probability / 4);
  if (f.guests > HARD_GUEST_LIMIT) probability = Math.trunc(probability / 4);
  if (f.entranceFeeCents > f.rideValueForMoney) {
    probability = Math.trunc(probability / 4);
    if (Math.trunc(f.entranceFeeCents / 2) > f.rideValueForMoney) {
      probability = Math.trunc(probability / 4);
    }
  }
  for (const active of f.awards) {
    if (active.expiresTick <= f.tick) continue;
    const award = AWARDS[active.awardId];
    if (!award) continue;
    const quarter = Math.trunc(probability / 4);
    probability += award.positive ? quarter : -quarter;
  }
  return probability;
}

function isOperating(world: World, slot: number): boolean {
  return world.rides.cols.state[slot] === RideState.Open;
}

/** Sum of the ride-type bonus of every open, working ride, stall and facility. */
export function suggestedGuestMaximum(world: World): number {
  let total = 0;
  for (let slot = 0; slot < world.rides.count; slot++) {
    if (!isOperating(world, slot)) continue;
    const type = world.rides.cols.typeId[slot] as RideType;
    total += RIDE_CATALOG[type]?.guestGenerationBonus ?? RIDE_BONUS_VALUE[type] ?? 0;
  }
  return Math.min(MAX_SUGGESTED_GUESTS, total);
}

/**
 * Twice the summed value of open rides beyond what they charge, in cents. An entrance fee above
 * this makes the park look overpriced to arriving guests.
 */
export function totalRideValueForMoney(world: World): number {
  const perRide = ridePricingEnabled(world);
  let total = 0;
  for (let slot = 0; slot < world.rides.count; slot++) {
    if (!isOperating(world, slot)) continue;
    const definition = RIDE_CATALOG[world.rides.cols.typeId[slot] as RideType];
    if (!definition || isShopCategory(definition.category)) continue;
    let value = getRideValueCents(world, world.rides.slotToId[slot]);
    if (perRide) value -= world.rides.cols.price[slot];
    if (value > 0) total += value * 2;
  }
  return total;
}

/** Recomputes the cached generation figures; run on the rating refresh cadence. */
export function refreshGuestGeneration(world: World): void {
  const l = world.economy;
  const suggested = suggestedGuestMaximum(world);
  const rideValueForMoney = totalRideValueForMoney(world);
  const generation: GuestGeneration = {
    probability: guestGenerationProbability({
      parkRating: l.parkRating,
      guests: world.guests.count,
      suggestedGuestMax: suggested,
      entranceFeeCents: gateAdmissionCents(world),
      rideValueForMoney,
      awards: l.activeAwards,
      tick: world.tick,
    }),
    suggestedGuestMax: suggested,
    rideValueForMoney,
  };
  l.guestGeneration = generation;
}

/**
 * Chance, out of `GENERATION_ROLL_RANGE`, per tick that the running campaign draws an extra
 * guest. Entry campaigns draw an eighth as many when the fee is already low; a free-ride
 * campaign likewise when the ride is already cheap.
 */
export function campaignGenerationProbability(world: World): number {
  const l = world.economy;
  if (l.campaignWeeksLeft <= 0 || l.campaignId === NO_CAMPAIGN) return 0;
  const campaign = CAMPAIGNS[l.campaignId];
  let probability = campaign.guestsPerTick;
  const fee = gateAdmissionCents(world);
  if (campaign.voucher === VoucherKind.FreeEntry && fee < FREE_ENTRY_FEE_FLOOR_CENTS) {
    probability = Math.trunc(probability / 8);
  } else if (
    campaign.voucher === VoucherKind.HalfPriceEntry &&
    fee < HALF_PRICE_ENTRY_FEE_FLOOR_CENTS
  ) {
    probability = Math.trunc(probability / 8);
  } else if (campaign.voucher === VoucherKind.FreeRide) {
    const price = priceOfRideId(world, l.campaignTarget);
    if (price === undefined || price < FREE_RIDE_PRICE_FLOOR_CENTS) {
      probability = Math.trunc(probability / 8);
    }
  }
  return probability;
}

function priceOfRideId(world: World, rideId: number): number | undefined {
  for (let slot = 0; slot < world.rides.count; slot++) {
    if (world.rides.slotToId[slot] === rideId) return world.rides.cols.price[slot];
  }
  return undefined;
}
