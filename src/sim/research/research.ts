export interface ResearchState {
  /** Funding level 0..3. */
  funding: number;
  progress: number;
  currentItemId: number;
  unlocked: Set<number>;
}

export function createResearch(): ResearchState {
  return { funding: 0, progress: 0, currentItemId: -1, unlocked: new Set() };
}
