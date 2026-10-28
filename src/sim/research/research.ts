import type { World } from '../core/world';
import { WEEKS_PER_MONTH } from '../economy/calendar';

export enum Funding {
  None = 0,
  Minimum = 1,
  Normal = 2,
  Maximum = 3,
}

/**
 * Cash paid per month at each funding level (economy.md: $0 / $100 / $200 / $400 per month).
 * Paid in weekly quarters (see FUNDING_WEEKLY_CENTS).
 */
export const FUNDING_MONTHLY_CENTS: readonly number[] = [0, 10_000, 20_000, 40_000];
/** Funding is paid out weekly: a quarter of the monthly figure each week. */
export const FUNDING_WEEKLY_CENTS: readonly number[] = FUNDING_MONTHLY_CENTS.map((monthly) =>
  Math.floor(monthly / WEEKS_PER_MONTH),
);

/**
 * Work added to research progress each week at each funding level. The reported intervals
 * (one invention about every 60, 45 and 30 days at minimum, normal and maximum funding) fix
 * the ratio: 3, 4 and 6 units per day, with 7 days a week. An invention of 180 units therefore
 * takes 60 days at minimum funding. Tunable; see DECISIONS.md.
 */
export const FUNDING_WORK_PER_WEEK: readonly number[] = [0, 21, 28, 42];

/**
 * Save format 8 stored invention costs and progress in cents, at the old weekly rate of
 * 2,500 cents at minimum funding. Converting at the same rate keeps each invention's duration
 * at minimum funding unchanged when an old save loads.
 */
const LEGACY_CENTS_PER_WEEK_AT_MINIMUM = 2_500;

export interface ResearchInvention {
  itemId: number;
  /** Bit index into enabledCategoryMask, 0..30. */
  category: number;
  /** Work required to complete; see FUNDING_WORK_PER_WEEK. */
  workUnits: number;
}

export interface ResearchState {
  funding: Funding;
  enabledCategoryMask: number;
  /** Index into `inventions` being worked on, or -1 when nothing is eligible. */
  currentIndex: number;
  progress: number;
  /** Ordered scenario invention list. */
  inventions: ResearchInvention[];
  /** Item ids the player ranked, first is researched first; unranked items follow scenario order. */
  priority: number[];
  /** Item ids available or discovered so far. */
  unlocked: Set<number>;
}

export type ResearchAction =
  | { type: 'setFunding'; level: Funding }
  | { type: 'setCategories'; mask: number }
  | { type: 'setPriority'; itemIds: number[] };

export function createResearch(): ResearchState {
  return {
    funding: Funding.None,
    enabledCategoryMask: 0,
    currentIndex: -1,
    progress: 0,
    inventions: [],
    priority: [],
    unlocked: new Set(),
  };
}

export function isUnlocked(world: World, itemId: number): boolean {
  return world.research.unlocked.has(itemId);
}

/** Scenario indices in research order: ranked items first, then the rest in scenario order. */
function researchOrder(r: ResearchState): number[] {
  const indexOf = new Map(r.inventions.map((inv, i) => [inv.itemId, i]));
  const ranked = r.priority.map((id) => indexOf.get(id) ?? -1).filter((i) => i >= 0);
  const rankedSet = new Set(ranked);
  const rest = r.inventions.map((_, i) => i).filter((i) => !rankedSet.has(i));
  return [...ranked, ...rest];
}

/** First undiscovered invention, in research order, whose category is enabled. */
export function nextEligibleInvention(r: ResearchState): number {
  for (const i of researchOrder(r)) {
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
      if (!(action.level in FUNDING_WORK_PER_WEEK)) return false;
      r.funding = action.level;
      return true;
    case 'setCategories':
      if (!Number.isInteger(action.mask)) return false;
      r.enabledCategoryMask = action.mask | 0;
      return true;
    case 'setPriority': {
      const known = new Set(r.inventions.map((inv) => inv.itemId));
      const seen = new Set<number>();
      for (const id of action.itemIds) {
        if (!known.has(id) || seen.has(id)) return false;
        seen.add(id);
      }
      r.priority = [...action.itemIds];
      return true;
    }
  }
}

export interface ResearchSave {
  funding: Funding;
  enabledCategoryMask: number;
  currentIndex: number;
  progress: number;
  inventions: ResearchInvention[];
  /** Absent in saves before player priorities existed; restores as scenario order. */
  priority?: number[];
  unlocked: number[];
}

/** Save format 8 research state: inventions and progress in cents. */
export interface LegacyResearchSave extends Omit<ResearchSave, 'inventions'> {
  inventions: { itemId: number; category: number; costCents: number }[];
}

/** Converts a format 8 research save to the current units, preserving time at minimum funding. */
export function upgradeLegacyResearchSave(s: LegacyResearchSave): ResearchSave {
  const toUnits = (cents: number): number =>
    Math.round((cents * FUNDING_WORK_PER_WEEK[Funding.Minimum]) / LEGACY_CENTS_PER_WEEK_AT_MINIMUM);
  return {
    ...s,
    progress: toUnits(s.progress),
    inventions: s.inventions.map((inv) => ({
      itemId: inv.itemId,
      category: inv.category,
      workUnits: toUnits(inv.costCents),
    })),
  };
}

export function saveResearch(r: ResearchState): ResearchSave {
  return {
    funding: r.funding,
    enabledCategoryMask: r.enabledCategoryMask,
    currentIndex: r.currentIndex,
    progress: r.progress,
    inventions: r.inventions.map((inv) => ({ ...inv })),
    priority: [...r.priority],
    unlocked: Array.from(r.unlocked),
  };
}

export function restoreResearch(r: ResearchState, s: ResearchSave): void {
  r.funding = s.funding;
  r.enabledCategoryMask = s.enabledCategoryMask;
  r.currentIndex = s.currentIndex;
  r.progress = s.progress;
  r.inventions = s.inventions.map((inv) => ({ ...inv }));
  r.priority = [...(s.priority ?? [])];
  r.unlocked = new Set(s.unlocked);
}
