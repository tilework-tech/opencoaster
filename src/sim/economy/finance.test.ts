import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { LOAN_STEP_CENTS, borrow, companyValue, repay, weeklyInterestCents } from './finance';
import { createLedger } from './ledger';
import type { Ledger } from './ledger';

function loanable(): Ledger {
  const l = createLedger();
  l.cash = 0;
  l.maxLoan = 10 * LOAN_STEP_CENTS;
  l.annualInterestBps = 1_000;
  return l;
}

describe('loans', () => {
  it('borrows in $1,000 steps up to the scenario ceiling', () => {
    const l = loanable();
    expect(borrow(l, LOAN_STEP_CENTS)).toBe(true);
    expect(l.loan).toBe(LOAN_STEP_CENTS);
    expect(l.cash).toBe(LOAN_STEP_CENTS);
    expect(borrow(l, 1)).toBe(false);
    expect(borrow(l, 10 * LOAN_STEP_CENTS)).toBe(false);
    expect(l.loan).toBe(LOAN_STEP_CENTS);
  });

  it('repays only up to the outstanding balance and available cash', () => {
    const l = loanable();
    borrow(l, 3 * LOAN_STEP_CENTS);
    l.cash = LOAN_STEP_CENTS;
    expect(repay(l, 2 * LOAN_STEP_CENTS)).toBe(false);
    expect(repay(l, LOAN_STEP_CENTS)).toBe(true);
    expect(l.loan).toBe(2 * LOAN_STEP_CENTS);
    expect(l.cash).toBe(0);
  });
});

describe('interest and company value', () => {
  it('charges a weekly share of the annual rate, rounded down', () => {
    const l = loanable();
    l.loan = 3_200_000;
    // 10% annual over 32 weeks per year: 3,200,000 * 1000 / (10000 * 32) = 10,000 cents
    expect(weeklyInterestCents(l)).toBe(10_000);
    l.loan = 0;
    expect(weeklyInterestCents(l)).toBe(0);
  });

  it('company value is park value plus cash minus loans', () => {
    const l = loanable();
    l.cash = 500_000;
    l.loan = 200_000;
    l.parkValue = 40_000;
    expect(companyValue(l)).toBe(340_000);
  });

  it('wires interest into the economy clock through the simulation', () => {
    const sim = new Simulation({ seed: 3, width: 16, height: 16 });
    sim.world.economy.maxLoan = 10_000_000;
    sim.world.economy.annualInterestBps = 1_000;
    borrow(sim.world.economy, 3_200_000);
    const before = sim.world.economy.cash;
    for (let i = 0; i <= 4096; i++) sim.step();
    expect(sim.world.economy.cash).toBe(before - 10_000);
  });
});
