import { WEEKS_PER_YEAR } from './calendar';
import { BASIS_POINTS } from './ledger';
import type { Ledger } from './ledger';

/** Player loan adjustments move in $1,000 steps. */
export const LOAN_STEP_CENTS = 100_000;

export function borrow(l: Ledger, cents: number): boolean {
  if (!isLoanStep(cents) || l.loan + cents > l.maxLoan) return false;
  l.loan += cents;
  l.cash += cents;
  return true;
}

/** Repayment is limited by the outstanding balance and by cash on hand. */
export function repay(l: Ledger, cents: number): boolean {
  if (!isLoanStep(cents) || cents > l.loan || cents > l.cash) return false;
  l.loan -= cents;
  l.cash -= cents;
  return true;
}

/** Weekly share of the annual rate, rounded down. Simple interest; see economy.md open question 2. */
export function weeklyInterestCents(l: Ledger): number {
  return Math.floor((l.loan * l.annualInterestBps) / (BASIS_POINTS * WEEKS_PER_YEAR));
}

export function companyValue(l: Ledger): number {
  return l.parkValue + l.cash - l.loan;
}

function isLoanStep(cents: number): boolean {
  return cents > 0 && cents % LOAN_STEP_CENTS === 0;
}
