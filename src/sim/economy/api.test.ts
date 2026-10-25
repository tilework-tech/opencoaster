import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { earn } from './api';
import { LedgerCategory } from './ledger';

describe('purchase audio events', () => {
  it('coalesces sales into one register cue per simulation tick', () => {
    const world = new Simulation({ seed: 1, width: 8, height: 8 }).world;
    earn(world, LedgerCategory.FoodDrinkSales, 100);
    earn(world, LedgerCategory.RideTickets, 50);
    expect(world.audioEvents).toEqual([{ id: 1, type: 'register' }]);
    world.tick++;
    earn(world, LedgerCategory.ShopSales, 25);
    expect(world.audioEvents.at(-1)).toEqual({ id: 2, type: 'register' });
  });

  it('does not play a register cue for recurring income or expenses', () => {
    const world = new Simulation({ seed: 2, width: 8, height: 8 }).world;
    earn(world, LedgerCategory.Admission, 100);
    earn(world, LedgerCategory.RideRunning, 500);
    expect(world.audioEvents).toEqual([{ id: 1, type: 'register' }]);
  });
});
