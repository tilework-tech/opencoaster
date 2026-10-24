import type { System } from '../core/system';
import type { World } from '../core/world';
import { TICKS_PER_WEEK, isBoundary } from '../economy/calendar';
import { charge } from '../economy/api';
import { LedgerCategory } from '../economy/ledger';
import { FUNDING_WEEKLY_CENTS, nextEligibleInvention } from './research';

/**
 * Weekly: funding is paid whether or not progress is possible. With no funding or no eligible
 * category, progress stops. Completed inventions unlock and leftover work carries forward.
 */
export const researchSystem: System = {
  name: 'research',
  update(world: World) {
    if (!isBoundary(world.tick, TICKS_PER_WEEK)) return;
    const r = world.research;
    const weekly = FUNDING_WEEKLY_CENTS[r.funding];
    if (weekly > 0) charge(world, LedgerCategory.Research, weekly);
    if (weekly === 0) return;

    let index = nextEligibleInvention(r);
    if (index !== r.currentIndex) {
      r.currentIndex = index;
      r.progress = 0;
    }
    if (index < 0) return;

    r.progress += weekly;
    while (index >= 0 && r.progress >= r.inventions[index].costCents) {
      r.progress -= r.inventions[index].costCents;
      r.unlocked.add(r.inventions[index].itemId);
      index = nextEligibleInvention(r);
    }
    r.currentIndex = index;
  },
};
