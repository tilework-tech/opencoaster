import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { TICKS_PER_MONTH } from './calendar';
import { LedgerCategory } from './ledger';
import { earn, charge } from './api';

function newSim(): Simulation {
  return new Simulation({ seed: 3, width: 16, height: 16 });
}

describe('ledger postings', () => {
  it('earn adds to cash and the current month; charge subtracts from both', () => {
    const sim = newSim();
    const start = sim.world.economy.cash;
    earn(sim.world, LedgerCategory.ShopSales, 250);
    charge(sim.world, LedgerCategory.Land, 1_000);
    expect(sim.world.economy.cash).toBe(start - 750);
    expect(sim.world.economy.monthlyTotals[LedgerCategory.ShopSales]).toBe(250);
    expect(sim.world.economy.monthlyTotals[LedgerCategory.Land]).toBe(-1_000);
  });

  it('rejects non-integer or negative amounts', () => {
    const sim = newSim();
    expect(() => earn(sim.world, LedgerCategory.ShopSales, 1.5)).toThrow(RangeError);
    expect(() => charge(sim.world, LedgerCategory.Land, -5)).toThrow(RangeError);
  });

  it('keeps completed months in history after the monthly rollover', () => {
    const sim = newSim();
    earn(sim.world, LedgerCategory.Admission, 500);
    for (let i = 0; i <= TICKS_PER_MONTH; i++) sim.step();
    expect(sim.world.economy.monthlyTotals[LedgerCategory.Admission]).toBe(0);
    expect(sim.world.economy.monthsCompleted).toBe(1);
  });
});
