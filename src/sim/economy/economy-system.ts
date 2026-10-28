import type { System } from '../core/system';
import type { World } from '../core/world';
import {
  RATING_REFRESH_TICKS,
  TICKS_PER_FORTNIGHT,
  TICKS_PER_MONTH,
  TICKS_PER_WEEK,
  isBoundary,
} from './calendar';
import { LedgerCategory, post, rollMonth } from './ledger';
import { weeklyInterestCents } from './finance';
import { chargeCampaignWeek } from './marketing';
import { DIFFICULT_RATING_BASE, RATING_BASE, computeParkRating, parkValueOf } from './park-rating';
import { evaluateMonthlyAward } from './awards';
import { refreshGuestGeneration } from './guest-generation';

/**
 * Order at a shared boundary: weekly charges, then fortnightly upkeep, then the monthly
 * rollover (so the boundary's charges land in the month that just ended), then rating refresh
 * and award assessment from the refreshed park state.
 */
export const economySystem: System = {
  name: 'economy',
  update(world: World) {
    const t = world.tick;
    const l = world.economy;
    if (isBoundary(t, TICKS_PER_WEEK)) {
      const wages = l.inputs.wageBillPerWeek;
      if (wages > 0) post(l, LedgerCategory.Wages, -wages);
      const interest = weeklyInterestCents(l);
      if (interest > 0) post(l, LedgerCategory.Interest, -interest);
      chargeCampaignWeek(l);
    }
    if (isBoundary(t, TICKS_PER_FORTNIGHT)) {
      const upkeep = l.inputs.rideUpkeepPerFortnight;
      if (upkeep > 0) post(l, LedgerCategory.RideRunning, -upkeep);
    }
    const monthBoundary = isBoundary(t, TICKS_PER_MONTH);
    if (monthBoundary) {
      rollMonth(l);
      l.inputs.drowningCasualtyPenalty = Math.floor((l.inputs.drowningCasualtyPenalty * 90) / 100);
      l.inputs.fatalRideCrashPenalty = Math.floor((l.inputs.fatalRideCrashPenalty * 90) / 100);
    }
    if (isBoundary(t, RATING_REFRESH_TICKS)) {
      const guests = world.guests.count;
      l.parkValue = parkValueOf(guests, l.inputs);
      const base = l.difficultRating ? DIFFICULT_RATING_BASE : RATING_BASE;
      l.parkRating = computeParkRating(guests, l.inputs, base);
      refreshGuestGeneration(world);
    }
    if (monthBoundary) evaluateMonthlyAward(world, t);
  },
};
