import type { World } from '../core/world';

export enum Funding {
  None = 0,
  Minimum = 1,
  Normal = 2,
  Maximum = 3,
}

/**
 * Cash paid per week at each funding level, and the work units (cents) added to progress.
 * Provisional values from a community reference (economy.md), tunable.
 */
export const FUNDING_WEEKLY_CENTS: readonly number[] = [0, 2_500, 5_000, 10_000];

export interface ResearchInvention {
  itemId: number;
  /** Bit index into enabledCategoryMask, 0..30. */
  category: number;
  /** Work required to complete, in cents of funding. */
  costCents: number;
}

export interface ResearchState {
  funding: Funding;
  enabledCategoryMask: number;
  /** Index into `inventions` being worked on, or -1 when nothing is eligible. */
  currentIndex: number;
  progress: number;
  /** Ordered scenario invention list. */
  inventions: ResearchInvention[];
  /** Item ids available or discovered so far. */
  unlocked: Set<number>;
}

export type ResearchAction =
  { type: 'setFunding'; level: Funding } | { type: 'setCategories'; mask: number };

export function createResearch(): ResearchState {
  return {
    funding: Funding.None,
    enabledCategoryMask: 0,
    currentIndex: -1,
    progress: 0,
    inventions: [],
    unlocked: new Set(),
  };
}

export function isUnlocked(world: World, itemId: number): boolean {
  return world.research.unlocked.has(itemId);
}

/** First undiscovered invention, in scenario order, whose category is enabled. */
export function nextEligibleInvention(r: ResearchState): number {
  for (let i = 0; i < r.inventions.length; i++) {
    const inv = r.inventions[i];
    if (r.unlocked.has(inv.itemId)) continue;
    if (((r.enabledCategoryMask >>> inv.category) & 1) === 0) continue;
    return i;
  }
  return -1;
}

export function applyResearchAction(r: ResearchState, action: ResearchAction): boolean {
  switch (action.type) {
    case 'setFunding':
      if (!(action.level in FUNDING_WEEKLY_CENTS)) return false;
      r.funding = action.level;
      return true;
    case 'setCategories':
      if (!Number.isInteger(action.mask)) return false;
      r.enabledCategoryMask = action.mask | 0;
      return true;
  }
}

export interface ResearchSave {
  funding: Funding;
  enabledCategoryMask: number;
  currentIndex: number;
  progress: number;
  inventions: ResearchInvention[];
  unlocked: number[];
}

export function saveResearch(r: ResearchState): ResearchSave {
  return {
    funding: r.funding,
    enabledCategoryMask: r.enabledCategoryMask,
    currentIndex: r.currentIndex,
    progress: r.progress,
    inventions: r.inventions.map((inv) => ({ ...inv })),
    unlocked: Array.from(r.unlocked),
  };
}

export function restoreResearch(r: ResearchState, s: ResearchSave): void {
  r.funding = s.funding;
  r.enabledCategoryMask = s.enabledCategoryMask;
  r.currentIndex = s.currentIndex;
  r.progress = s.progress;
  r.inventions = s.inventions.map((inv) => ({ ...inv }));
  r.unlocked = new Set(s.unlocked);
}
