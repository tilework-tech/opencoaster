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
  it('charges the RCT2-compatible weekly interest amount, rounded down per payment', () => {
    const l = loanable();
    l.loan = 2_000_000;
    expect(weeklyInterestCents(l)).toBe(6_103);
    l.loan = 3_200_000;
    expect(weeklyInterestCents(l)).toBe(9_765);
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
    expect(sim.world.economy.cash).toBe(before - 9_765);
  });
});

describe('loan limits', () => {
  it('borrows up to the scenario maximum exactly and no further', () => {
    const l = loanable();
    l.maxLoan = 300_000;
    expect(borrow(l, 300_000)).toBe(true);
    expect(borrow(l, 100_000)).toBe(false);
    expect(l.loan).toBe(300_000);
  });

  it('rejects partial steps and repayments beyond the balance or cash', () => {
    const l = loanable();
    l.maxLoan = 300_000;
    l.loan = 100_000;
    l.cash = 500_000;
    expect(repay(l, 150_000)).toBe(false);
    expect(repay(l, 200_000)).toBe(false);
    expect(repay(l, 100_000)).toBe(true);
    expect(l.loan).toBe(0);
  });

  it('stops charging interest once the loan is repaid', () => {
    const l = loanable();
    l.loan = 100_000;
    l.cash = 500_000;
    repay(l, 100_000);
    expect(weeklyInterestCents(l)).toBe(0);
  });
});
