import type { EconomyInputs } from './ledger';

export const MAX_RATING = 999;
const RATING_BASE = 1150;
/** $7 per guest, expressed in cents. */
export const PARK_VALUE_PER_GUEST_CENTS = 700;

export function parkValueOf(guests: number, inputs: EconomyInputs): number {
  return inputs.rideValue + PARK_VALUE_PER_GUEST_CENTS * guests;
}

/**
 * Community-derived rating formula (economy.md). The guest term follows the guide's stated
 * range (-150 at 0 guests to about +3 at 2000). Excitement and intensity terms are not
 * implemented yet. Constants are tunable and unverified against the original game.
 */
export function computeParkRating(guests: number, inputs: EconomyInputs): number {
  const guestTerm = Math.floor(Math.min(guests, 2000) / 13) - 150;
  const happinessPenalty = Math.min(500, Math.max(0, inputs.unhappyPercent - 50) * 10);
  const lostPenalty = Math.max(0, inputs.lostGuests - 25) * 7;
  const uptimePenalty = Math.min(200, inputs.rideDowntimePercent * 2);
  const litterPenalty = Math.min(600, inputs.litter * 4);
  const casualtyPenalty = Math.min(1000, inputs.casualties * 100);
  const raw =
    RATING_BASE +
    guestTerm -
    happinessPenalty -
    lostPenalty -
    uptimePenalty -
    litterPenalty -
    casualtyPenalty;
  return Math.min(MAX_RATING, Math.max(0, raw));
}
