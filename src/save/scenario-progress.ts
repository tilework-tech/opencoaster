export const SCENARIO_PROGRESS_KEY = 'opencoaster.scenarioProgress.v1';

/** What the browser remembers about a scenario the player has won. */
export interface ScenarioCompletion {
  /** Wall-clock milliseconds when the win was first recorded. */
  completedAt: number;
}

export type ScenarioProgress = Record<string, ScenarioCompletion>;

/** Reads stored progress, dropping malformed entries; unreadable storage means no progress. */
export function parseScenarioProgress(raw: string | null): ScenarioProgress {
  if (raw === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const progress: ScenarioProgress = {};
  for (const [id, entry] of Object.entries(value)) {
    const at = (entry as { completedAt?: unknown } | null)?.completedAt;
    if (typeof at === 'number' && Number.isFinite(at)) progress[id] = { completedAt: at };
  }
  return progress;
}

export function loadScenarioProgress(storage: Storage = localStorage): ScenarioProgress {
  return parseScenarioProgress(storage.getItem(SCENARIO_PROGRESS_KEY));
}

/**
 * Records a win. The first completion time is kept; returns true when the scenario was not
 * already recorded.
 */
export function markScenarioCompleted(
  id: string,
  now: number,
  storage: Storage = localStorage,
): boolean {
  const progress = loadScenarioProgress(storage);
  if (progress[id]) return false;
  progress[id] = { completedAt: now };
  storage.setItem(SCENARIO_PROGRESS_KEY, JSON.stringify(progress));
  return true;
}
