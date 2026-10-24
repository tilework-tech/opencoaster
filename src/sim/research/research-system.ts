import type { System } from '../core/system';
import type { World } from '../core/world';
import { TICKS_PER_MONTH, TICKS_PER_WEEK, isBoundary } from '../economy/calendar';
import { charge } from '../economy/api';
import { LedgerCategory } from '../economy/ledger';
import { FUNDING_MONTHLY_CENTS, FUNDING_WORK_PER_WEEK, nextEligibleInvention } from './research';

/**
 * Funding is paid monthly at the chosen level, whether or not progress is possible. Progress
 * accrues weekly; with no funding or no enabled category it stops. Completed inventions unlock
 * and leftover work carries forward. Charges and progress land on boundaries, before the
 * economy's monthly rollover (see economy-system.ts).
 */
export const researchSystem: System = {
  name: 'research',
  update(world: World) {
    const r = world.research;
    if (isBoundary(world.tick, TICKS_PER_MONTH)) {
      const monthly = FUNDING_MONTHLY_CENTS[r.funding];
      if (monthly > 0) charge(world, LedgerCategory.Research, monthly);
    }
    if (!isBoundary(world.tick, TICKS_PER_WEEK)) return;

    const weekly = FUNDING_WORK_PER_WEEK[r.funding];
    if (weekly === 0) return;

    let index = nextEligibleInvention(r);
    if (index !== r.currentIndex) {
      r.currentIndex = index;
      r.progress = 0;
    }
    if (index < 0) return;

    r.progress += weekly;
    while (index >= 0 && r.progress >= r.inventions[index].workUnits) {
      r.progress -= r.inventions[index].workUnits;
      r.unlocked.add(r.inventions[index].itemId);
      index = nextEligibleInvention(r);
    }
    r.currentIndex = index;
  },
};
